// /api/bling/callback — recebe o retorno do OAuth do Bling, troca o code por
// tokens e grava na tabela integracoes_erp (via service_role, nunca exposto ao navegador).
//
// Variáveis de ambiente necessárias (configurar no Vercel):
//   BLING_CLIENT_ID, BLING_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/app?bling_erro=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.status(400).send('Parâmetros ausentes (code/state).');
  }

  const subscriberId = state; // definido como subscriber_id ao iniciar o fluxo

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const redirectUri = `https://${req.headers.host}/api/bling/callback`;

  try {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResp = await fetch(BLING_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '1.0',
        'Authorization': `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      console.error('Bling token exchange failed', tokenData);
      return res.redirect('/app?bling_erro=token_exchange_failed');
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 21600) * 1000).toISOString();

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const upsertResp = await fetch(`${supabaseUrl}/rest/v1/integracoes_erp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        provider: 'bling',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!upsertResp.ok) {
      const errText = await upsertResp.text();
      console.error('Supabase upsert failed', errText);
      return res.redirect('/app?bling_erro=save_failed');
    }

    return res.redirect('/app?bling_conectado=1');
  } catch (err) {
    console.error('Bling callback error', err);
    return res.redirect('/app?bling_erro=unexpected');
  }
}
