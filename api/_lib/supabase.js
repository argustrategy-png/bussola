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
