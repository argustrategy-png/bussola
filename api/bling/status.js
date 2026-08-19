// /api/bling/status — diz se o usuário autenticado tem o Bling conectado,
// sem nunca devolver o token pro navegador.

async function getAuthenticatedSubscriber(req) {
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return null;
  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user?.id || null;
}

export default async function handler(req, res) {
  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&provider=eq.bling&select=ultima_sincronizacao,created_at`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const rows = await resp.json();
  const row = rows?.[0];

  return res.status(200).json({
    conectado: !!row,
    ultima_sincronizacao: row?.ultima_sincronizacao || null,
  });
}
