// GET /api/erp/status — lista as integrações conectadas do usuário autenticado
// (sem nunca devolver tokens pro navegador).

import { getAuthenticatedSubscriber, listIntegracoes } from '../_lib/supabase.js';

export default async function handler(req, res) {
  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const integracoes = await listIntegracoes(subscriberId);
  return res.status(200).json({ integracoes });
}
