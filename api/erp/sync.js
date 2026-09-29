// POST /api/erp/sync  { provider: 'bling' }
// Busca contas a pagar/receber no ERP conectado e grava em `lancamentos` (origem='erp').

import { getProvider } from '../_lib/providers/index.js';
import {
  getAuthenticatedSubscriber,
  getIntegracao,
  patchIntegracao,
  upsertLancamentos,
  upsertProdutos,
  upsertVendasItens,
  getContatosCache,
  upsertContatosCache,
} from '../_lib/supabase.js';

// Teto de contatos novos buscados por sincronização — o resto fica com o
// placeholder "Contato Bling #id" nesta rodada e é resolvido nas próximas
// (o cache é cumulativo). Busca é sequencial e espaçada pra respeitar o
// limite de taxa do Bling (~350ms por contato), então o teto também existe
// pra sobrar tempo pras outras etapas do sync dentro do limite da function
// (120 contatos ≈ 42s, deixando folga dentro dos 60s configurados).
const MAX_CONTATOS_NOVOS_POR_SYNC = 120;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { provider: providerName } = req.body || {};
  if (!providerName) return res.status(400).json({ error: 'provider obrigatório' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return res.status(400).json({ error: 'provider_desconhecido' });
  }

  let integracao = await getIntegracao(subscriberId, providerName);
  if (!integracao) return res.status(404).json({ error: 'erp_nao_conectado' });

  try {
    // Providers OAuth2 têm token que expira e precisa renovar; apikey não.
    if (provider.authType === 'oauth2' && new Date(integracao.expires_at).getTime() < Date.now() + 60_000) {
      const refreshed = await provider.refreshToken({ refreshToken: integracao.refresh_token });
      const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
      await patchIntegracao(integracao.id, {
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken,
        expires_at: expiresAt,
      });
      integracao = { ...integracao, access_token: refreshed.accessToken };
    }

    // OAuth2 usa accessToken/realmId; apikey usa os campos declarados em
    // provider.credentialFields, guardados em `credentials` (jsonb). Uma
    // integração Omie antiga (de antes dessa coluna existir) ainda guarda
    // appKey/appSecret em access_token/refresh_token — cai no fallback abaixo.
    const ctx = provider.authType === 'oauth2'
      ? { accessToken: integracao.access_token, realmId: integracao.erp_account_id }
      : (integracao.credentials || { appKey: integracao.access_token, appSecret: integracao.refresh_token });

    // Sequencial, não em paralelo: cada chamada pagina sozinha, e rodar as
    // duas ao mesmo tempo dobra o ritmo de chamadas contra o limite de taxa
    // do ERP (Bling: 3 requisições/segundo) — visto derrubando a sincronização
    // de contas com bastante histórico.
    const pagar = await provider.fetchContas({ ...ctx, tipo: 'pagar' });
    const receber = await provider.fetchContas({ ...ctx, tipo: 'receber' });

    // Nome do contato: alguns providers (hoje só Bling) não trazem o nome já
    // na listagem de contas, só o ID — busca à parte, cacheada, pra não achar
    // "Contato Bling #123" em vez do nome do cliente/fornecedor no painel.
    let contatosMap = {};
    if (typeof provider.fetchContatoNomes === 'function') {
      try {
        const idsUnicos = [...new Set(
          [...pagar, ...receber].map((c) => c.contato?.id).filter(Boolean).map(String)
        )];
        if (idsUnicos.length) {
          const cache = await getContatosCache(subscriberId, providerName, idsUnicos);
          const faltantes = idsUnicos.filter((id) => !cache[id]).slice(0, MAX_CONTATOS_NOVOS_POR_SYNC);
          let novos = {};
          if (faltantes.length) {
            novos = await provider.fetchContatoNomes(ctx, faltantes);
            const registros = Object.entries(novos).map(([contatoErpId, nome]) => ({
              subscriber_id: subscriberId, provider: providerName, contato_erp_id: contatoErpId, nome,
            }));
            const r = await upsertContatosCache(registros);
            if (!r.ok) console.error(`${providerName} sync contatos: falha ao gravar cache`, await r.text());
          }
          contatosMap = { ...cache, ...novos };
        }
      } catch (err) {
        console.error(`${providerName} sync contatos error`, err);
      }
    }

    const lancamentos = [
      ...pagar.map((c) => provider.mapConta(c, 'pagar', subscriberId, contatosMap)),
      ...receber.map((c) => provider.mapConta(c, 'receber', subscriberId, contatosMap)),
    ];

    let gravados = 0;
    if (lancamentos.length) {
      const upsertResp = await upsertLancamentos(lancamentos);
      if (!upsertResp.ok) throw new Error(`Falha ao gravar lançamentos: ${await upsertResp.text()}`);
      gravados = lancamentos.length;
    }

    // Estoque e itens vendidos: só pra providers que implementam isso (hoje
    // só Bling). Roda separado, sem deixar uma falha aqui derrubar o sync
    // de contas a pagar/receber, que já é validado e é o que mais importa.
    let produtosSincronizados = 0, itensVendaSincronizados = 0;
    if (typeof provider.fetchProdutos === 'function') {
      try {
        const produtosBrutos = await provider.fetchProdutos(ctx);
        const produtos = produtosBrutos.map((p) => provider.mapProduto(p, subscriberId));
        if (produtos.length) {
          const r = await upsertProdutos(produtos);
          if (!r.ok) throw new Error(await r.text());
          produtosSincronizados = produtos.length;
        }
      } catch (err) {
        console.error(`${providerName} sync produtos error`, err);
      }
    }
    if (typeof provider.fetchItensVenda === 'function') {
      try {
        const pedidosComItens = await provider.fetchItensVenda(ctx);
        const itens = pedidosComItens.flatMap(({ pedido, itens: itensPedido }) =>
          itensPedido.map((item) => provider.mapItemVenda(pedido, item, subscriberId))
        );
        if (itens.length) {
          const r = await upsertVendasItens(itens);
          if (!r.ok) throw new Error(await r.text());
          itensVendaSincronizados = itens.length;
        }
      } catch (err) {
        console.error(`${providerName} sync itens de venda error`, err);
      }
    }

    await patchIntegracao(integracao.id, { ultima_sincronizacao: new Date().toISOString() });

    return res.status(200).json({ ok: true, sincronizados: gravados, produtosSincronizados, itensVendaSincronizados });
  } catch (err) {
    console.error(`${providerName} sync error`, err);
    return res.status(500).json({ error: 'sync_failed', detail: String(err.message || err) });
  }
}
