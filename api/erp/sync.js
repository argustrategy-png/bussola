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
} from '../_lib/supabase.js';

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

    const [pagar, receber] = await Promise.all([
      provider.fetchContas({ ...ctx, tipo: 'pagar' }),
      provider.fetchContas({ ...ctx, tipo: 'receber' }),
    ]);

    const lancamentos = [
      ...pagar.map((c) => provider.mapConta(c, 'pagar', subscriberId)),
      ...receber.map((c) => provider.mapConta(c, 'receber', subscriberId)),
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
