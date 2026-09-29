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

// Orçamento de tempo pra resolver nomes de contato novos, calculado com o que
// *sobra* depois de buscar as contas — não um número fixo a partir do início
// da function. Um orçamento fixo (testado: 20s a partir do início) ignorava
// que buscar as contas sozinho já podia consumir esse tempo todo em contas
// com bastante histórico (visto em produção: 0 contatos resolvidos mesmo após
// vários syncs OK, porque a etapa de contatos nunca chegava a rodar). Reserva
// tempo pras etapas seguintes (gravar lançamentos, produtos, itens de venda,
// marcar sincronizado) pra não estourar os 60s da function.
const LIMITE_FUNCTION_MS = 58_000; // margem sob o teto real de 60s
const RESERVA_POS_CONTATOS_MS = 15_000;
const MAX_CONTATOS_CANDIDATOS = 400; // teto só pra não montar um array enorme à toa

export default async function handler(req, res) {
  const inicioHandler = Date.now();
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
    console.log(`${providerName} sync: contas levaram ${Date.now() - inicioHandler}ms (pagar ${pagar.length}, receber ${receber.length})`);

    // Contas pagas em moeda estrangeira: a conta em si não tem campo de
    // moeda, mas o lançamento bancário que a baixou (Caixas e Bancos) já vem
    // convertido pra R$ — troca o valor bruto da conta pelo valor baixado
    // antes de mapear, só pra contas totalmente pagas (situacao 2). Só
    // Bling implementa isso hoje; outro provider sem esse método, pula.
    if (typeof provider.fetchValoresPagosPorDuplicata === 'function') {
      try {
        const valoresPagos = await provider.fetchValoresPagosPorDuplicata(ctx);
        console.log(`${providerName} sync: valores pagos levaram ${Date.now() - inicioHandler}ms (${Object.keys(valoresPagos).length} duplicata(s) com baixa no período)`);
        [...pagar, ...receber].forEach((c) => {
          const valorPago = valoresPagos[String(c.id)];
          if (c.situacao === 2 && valorPago !== undefined) c.valor = valorPago;
        });
      } catch (err) {
        console.error(`${providerName} sync valores pagos error`, err);
      }
    }

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
          const faltantes = idsUnicos.filter((id) => !cache[id]).slice(0, MAX_CONTATOS_CANDIDATOS);
          let novos = {};
          if (faltantes.length) {
            const orcamentoContatos = Math.max(0, LIMITE_FUNCTION_MS - (Date.now() - inicioHandler) - RESERVA_POS_CONTATOS_MS);
            novos = await provider.fetchContatoNomes(ctx, faltantes, Date.now() + orcamentoContatos);
            console.log(`${providerName} sync: orçamento contatos ${orcamentoContatos}ms, resolvidos ${Object.keys(novos).length}/${faltantes.length} (${idsUnicos.length} contatos distintos no total)`);
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
