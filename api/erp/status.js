// GET  /api/erp/status — lista as integrações conectadas do usuário autenticado
// (sem nunca devolver tokens pro navegador).
// POST /api/erp/status { action: 'oauth_state', provider } — emite o `state`
// assinado pra iniciar a conexão OAuth2 (ver _lib/oauth-state.js). Fica nesta
// rota porque o plano Hobby da Vercel limita a 12 functions por deploy.

import { getAuthenticatedSubscriber, listIntegracoes } from '../_lib/supabase.js';
import { getProvider } from '../_lib/providers/index.js';
import { criarState, cookieNonce } from '../_lib/oauth-state.js';

export default async function handler(req, res) {
  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  if (req.method === 'POST') {
    const { action, provider: providerName } = req.body || {};
    if (action !== 'oauth_state') return res.status(400).json({ error: 'action inválida' });
    let provider;
    try {
      provider = getProvider(providerName);
    } catch {
      return res.status(400).json({ error: 'provider_desconhecido' });
    }
    if (provider.authType !== 'oauth2') return res.status(400).json({ error: 'provider_nao_usa_oauth' });

    const { state, nonce } = criarState(subscriberId, providerName);
    res.setHeader('Set-Cookie', cookieNonce(nonce));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ state });
  }

  const integracoes = await listIntegracoes(subscriberId);
  return res.status(200).json({ integracoes });
}
