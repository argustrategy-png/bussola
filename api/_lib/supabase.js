// Helpers compartilhados para falar com o Supabase a partir das funções serverless.
// Sempre via service_role (nunca exposto ao navegador) ou validando o JWT do usuário.

export async function getAuthenticatedSubscriber(req) {
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return null;
  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user?.id || null;
}

function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

export async function getIntegracao(subscriberId, provider) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&provider=eq.${provider}&select=*`,
    { headers: serviceHeaders() }
  );
  const rows = await resp.json();
  return rows?.[0] || null;
}

export async function listIntegracoes(subscriberId) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&select=provider,ultima_sincronizacao,created_at`,
    { headers: serviceHeaders() }
  );
  return resp.json();
}

export async function upsertIntegracao(payload) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes_erp`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
  });
}

export async function patchIntegracao(id, payload) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?id=eq.${id}`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
  });
}

export async function deleteIntegracao(subscriberId, provider) {
  return fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&provider=eq.${provider}`,
    { method: 'DELETE', headers: serviceHeaders() }
  );
}

// erp_account_id identifica a empresa/conta do lado do ERP (CNPJ no Bling,
// realmId no QuickBooks, etc.) — usado pra impedir que a mesma conta de ERP
// seja conectada a duas contas MeuArgus diferentes.
export async function erpAccountJaConectadoEmOutraConta(provider, erpAccountId, subscriberId) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?provider=eq.${provider}&erp_account_id=eq.${encodeURIComponent(erpAccountId)}&select=subscriber_id`,
    { headers: serviceHeaders() }
  );
  const existing = await resp.json();
  return existing?.some((row) => row.subscriber_id !== subscriberId);
}

export async function upsertLancamentos(lancamentos) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/lancamentos?on_conflict=erp_id`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(lancamentos),
  });
}

export async function upsertProdutos(produtos) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/produtos?on_conflict=subscriber_id,provider,erp_id`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(produtos),
  });
}

export async function upsertVendasItens(itens) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/vendas_itens?on_conflict=subscriber_id,provider,pedido_erp_id,produto_erp_id`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(itens),
  });
}

// Cache de nome de contato por ID do ERP (ver supabase-migration-contatos.sql)
// — evita rebuscar o mesmo contato a cada sincronização.
export async function getContatosCache(subscriberId, provider, ids) {
  if (!ids.length) return {};
  const idsParam = ids.map((id) => encodeURIComponent(id)).join(',');
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/contatos_cache?subscriber_id=eq.${subscriberId}&provider=eq.${provider}&contato_erp_id=in.(${idsParam})&select=contato_erp_id,nome`,
    { headers: serviceHeaders() }
  );
  if (!resp.ok) return {};
  const rows = await resp.json();
  const mapa = {};
  (rows || []).forEach((r) => { mapa[r.contato_erp_id] = r.nome; });
  return mapa;
}

export async function upsertContatosCache(registros) {
  if (!registros.length) return { ok: true };
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/contatos_cache?on_conflict=subscriber_id,provider,contato_erp_id`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(registros),
  });
}

// Estado de progresso de uma sincronização resumível (ver sincronizarPosicaoCaixa
// em sync.js) — guarda página atual + acumulado parcial enquanto não termina,
// apagado quando a sincronização conclui.
export async function getSyncEstado(subscriberId, provider, tipo) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/sync_estado?subscriber_id=eq.${subscriberId}&provider=eq.${provider}&tipo=eq.${tipo}&select=estado`,
    { headers: serviceHeaders() }
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows?.[0]?.estado || null;
}

export async function saveSyncEstado(subscriberId, provider, tipo, estado) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/sync_estado?on_conflict=subscriber_id,provider,tipo`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ subscriber_id: subscriberId, provider, tipo, estado, updated_at: new Date().toISOString() }),
  });
}

export async function deleteSyncEstado(subscriberId, provider, tipo) {
  return fetch(
    `${process.env.SUPABASE_URL}/rest/v1/sync_estado?subscriber_id=eq.${subscriberId}&provider=eq.${provider}&tipo=eq.${tipo}`,
    { method: 'DELETE', headers: serviceHeaders() }
  );
}

// Saldos de caixa já calculados (posição de caixa automática) — linhas com
// conta_financeira_id preenchido, uma por conta do ERP.
export async function getSaldosCaixasCalculados(subscriberId, provider) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/saldos_caixas?subscriber_id=eq.${subscriberId}&provider=eq.${provider}&conta_financeira_id=not.is.null&select=conta_financeira_id,nome,valor,ultima_data_sincronizada`,
    { headers: serviceHeaders() }
  );
  if (!resp.ok) return [];
  return resp.json();
}

export async function upsertSaldosCaixas(registros) {
  if (!registros.length) return { ok: true };
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/saldos_caixas?on_conflict=subscriber_id,provider,conta_financeira_id`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify(registros),
  });
}
