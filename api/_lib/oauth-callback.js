// Handler compartilhado para o callback OAuth2 de qualquer ERP.
// Cada api/<provider>/callback.js é só um wrapper fino chamando isto — o
// redirect URI precisa ser fixo por provedor (exigência dos próprios ERPs),
// então não dá pra ter um único endpoint genérico para o callback em si.

import { getProvider } from './providers/index.js';
import { upsertIntegracao, erpAccountJaConectadoEmOutraConta } from './supabase.js';

export async function handleOAuthCallback(providerName, req, res) {
  const provider = getProvider(providerName);
  const { code, state, error, realmId } = req.query;

  if (error) return res.redirect(`/app?erp_erro=${encodeURIComponent(error)}`);
  if (!code || !state) return res.status(400).send('Parâmetros ausentes (code/state).');

  const subscriberId = state;
  const redirectUri = `https://${req.headers.host}/api/${providerName}/callback`;

  try {
    const { accessToken, refreshToken, expiresIn } = await provider.exchangeCode({ code, redirectUri });
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // TEMPORÁRIO: a checagem de "1 conta ERP = 1 conta MeuArgus" deveria ser
    // obrigatória, mas o endpoint fetchAccountId do Bling está retornando 404
    // (path incorreto, ainda não confirmado na documentação). Por ora, se a
    // verificação falhar, deixamos conectar mesmo assim (best-effort) em vez
    // de bloquear a integração inteira — reverter para bloqueio assim que o
    // endpoint certo for confirmado. Ver console.error abaixo para diagnóstico.
    let erpAccountId = null;
    try {
      erpAccountId = await provider.fetchAccountId({ accessToken, realmId });
    } catch (e) {
      console.error(`${providerName} fetchAccountId falhou (seguindo sem a trava de conta única)`, e);
    }

    if (erpAccountId && await erpAccountJaConectadoEmOutraConta(providerName, erpAccountId, subscriberId)) {
      return res.redirect(`/app?erp_erro=ja_conectado&provider=${providerName}`);
    }

    const upsertResp = await upsertIntegracao({
      subscriber_id: subscriberId,
      provider: providerName,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      erp_account_id: erpAccountId,
    });
    if (!upsertResp.ok) {
      console.error('Falha ao salvar integração', await upsertResp.text());
      return res.redirect(`/app?erp_erro=save_failed&provider=${providerName}`);
    }

    return res.redirect(`/app?erp_conectado=${providerName}`);
  } catch (err) {
    console.error(`${providerName} callback error`, err);
    return res.redirect(`/app?erp_erro=unexpected&provider=${providerName}`);
  }
}
