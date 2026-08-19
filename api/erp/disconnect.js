// POST /api/erp/disconnect  { provider: 'bling' }

import { getAuthenticatedSubscriber, deleteIntegracao } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const { provider } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider obrigatório' });

  const resp = await deleteIntegracao(subscriberId, provider);
  if (!resp.ok) return res.status(500).json({ error: 'falha_ao_desconectar' });

  return res.status(200).json({ ok: true });
}
