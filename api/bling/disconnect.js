// /api/bling/disconnect — remove a integração do Bling do usuário autenticado.

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&provider=eq.bling`,
    {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!resp.ok) return res.status(500).json({ error: 'falha_ao_desconectar' });

  return res.status(200).json({ ok: true });
}
