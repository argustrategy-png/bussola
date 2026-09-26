// POST /api/admin/user-action  { userId, action: 'set_password' | 'confirm_email' | 'bling_homologacao', password? }
// (Uma rota só de admin: o plano Hobby da Vercel limita a 12 functions por deploy.)
// Só administradores (subscribers.is_admin). Usa a service_role pra mexer em auth.users.

import { getAuthenticatedSubscriber } from '../_lib/supabase.js';
import { rodarHomologacaoBling } from '../_lib/bling-homologacao.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function isAdmin(userId) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?id=eq.${userId}&select=is_admin`,
    { headers: serviceHeaders() }
  );
  const rows = await resp.json();
  return rows?.[0]?.is_admin === true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const callerId = await getAuthenticatedSubscriber(req);
  if (!callerId) return res.status(401).json({ error: 'não autenticado' });
  if (!(await isAdmin(callerId))) return res.status(403).json({ error: 'apenas_admin' });

  const { userId, action, password } = req.body || {};
  if (!userId || !UUID.test(userId)) return res.status(400).json({ error: 'userId inválido' });

  if (action === 'bling_homologacao') {
    const { status, body } = await rodarHomologacaoBling(userId);
    return res.status(status).json(body);
  }

  let body;
  if (action === 'set_password') {
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    }
    body = { password };
  } else if (action === 'confirm_email') {
    body = { email_confirm: true };
  } else {
    return res.status(400).json({ error: 'action inválida' });
  }

  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    console.error('admin user-action falhou', action, resp.status);
    return res.status(500).json({ error: 'falha_supabase', detail: detail.slice(0, 200) });
  }

  console.log(`admin ${callerId} executou ${action} em ${userId}`);
  return res.status(200).json({ ok: true });
}
