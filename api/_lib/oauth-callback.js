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

    // Obrigatório: identifica a conta do ERP (CNPJ no Bling, realmId no
    // QuickBooks...). Se não der pra confirmar, não prosseguimos — é o que
    // impede a mesma conta de ERP de ser usada em duas contas MeuArgus.
    let erpAccountId;
    try {
      erpAccountId = await provider.fetchAccountId({ accessToken, realmId });
    } catch (e) {
      console.error(`${providerName} fetchAccountId falhou`, e);
      return res.redirect(`/app?erp_erro=conta_nao_verificada&provider=${providerName}`);
    }

    if (await erpAccountJaConectadoEmOutraConta(providerName, erpAccountId, subscriberId)) {
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
