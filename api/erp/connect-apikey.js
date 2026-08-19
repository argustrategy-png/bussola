// POST /api/erp/connect-apikey  { provider: 'omie', appKey: '...', appSecret: '...' }
// Para ERPs sem OAuth2 (hoje: Omie) — valida as credenciais e salva.

import { getProvider } from '../_lib/providers/index.js';
import {
  getAuthenticatedSubscriber,
  upsertIntegracao,
  erpAccountJaConectadoEmOutraConta,
} from '../_lib/supabase.js';

const NUNCA_EXPIRA = new Date('2099-01-01').toISOString();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const { provider: providerName, appKey, appSecret } = req.body || {};
  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return res.status(400).json({ error: 'provider_desconhecido' });
  }
  if (provider.authType !== 'apikey') return res.status(400).json({ error: 'provider_nao_usa_apikey' });
  if (!appKey || !appSecret) return res.status(400).json({ error: 'appKey e appSecret obrigatórios' });

  try {
    const erpAccountId = await provider.fetchAccountId({ appKey, appSecret });

    if (await erpAccountJaConectadoEmOutraConta(providerName, erpAccountId, subscriberId)) {
      return res.status(409).json({ error: 'ja_conectado_em_outra_conta' });
    }

    const upsertResp = await upsertIntegracao({
      subscriber_id: subscriberId,
      provider: providerName,
      access_token: appKey,
      refresh_token: appSecret,
      expires_at: NUNCA_EXPIRA,
      erp_account_id: erpAccountId,
    });
    if (!upsertResp.ok) throw new Error(await upsertResp.text());

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`${providerName} connect-apikey error`, err);
    return res.status(400).json({ error: 'credenciais_invalidas', detail: String(err.message || err) });
  }
}
