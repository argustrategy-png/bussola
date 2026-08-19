// Adaptador QuickBooks Online — segue o mesmo formato do bling.js.
//
// ⚠️ PENDENTE DE CONFIGURAÇÃO:
//   1. Criar um app em https://developer.intuit.com (Intuit Developer Portal)
//   2. Registrar o redirect URI: https://meuargus.com/api/quickbooks/callback
//   3. Adicionar no Vercel: QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET
//
// Particularidade do QuickBooks: cada empresa conectada tem um "realmId"
// (vem como query param `realmId` no callback OAuth) — ele já FUNCIONA como o
// identificador único de conta (equivalente ao CNPJ do Bling), então
// fetchAccountId não precisa de uma chamada extra à API, só ler o realmId
// que vem no próprio callback (ver api/quickbooks/callback.js).
// As consultas usam Query Language: SELECT * FROM Bill (contas a pagar) e
// SELECT * FROM Invoice (contas a receber).

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company';

export const quickbooks = {
  name: 'quickbooks',
  label: 'QuickBooks',
  authType: 'oauth2',

  authorizeUrl({ state, redirectUri }) {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const scope = 'com.intuit.quickbooks.accounting';
    return `${AUTHORIZE_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const basic = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`QuickBooks exchangeCode falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in || 3600 };
  },

  async refreshToken({ refreshToken }) {
    const basic = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`QuickBooks refreshToken falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 3600 };
  },

  // O realmId chega no callback OAuth (query param), não numa chamada separada.
  // Aqui só validamos que foi informado — ver api/quickbooks/callback.js.
  async fetchAccountId({ realmId }) {
    if (!realmId) throw new Error('QuickBooks: realmId ausente no callback OAuth.');
    return realmId;
  },

  async fetchContas({ accessToken, tipo, realmId }) {
    const entity = tipo === 'pagar' ? 'Bill' : 'Invoice';
    const query = encodeURIComponent(`select * from ${entity} maxresults 100`);
    const resp = await fetch(`${API_BASE}/${realmId}/query?query=${query}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`QuickBooks query ${entity} falhou: ${resp.status} ${await resp.text()}`);
    const json = await resp.json();
    return json?.QueryResponse?.[entity] || [];
  },

  mapConta(item, tipo, subscriberId) {
    const contraparteNome = item.VendorRef?.name || item.CustomerRef?.name || null;
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: item.PrivateNote || item.DocNumber || `${tipo === 'pagar' ? 'Bill' : 'Invoice'} QuickBooks #${item.Id}`,
      valor: Number(item.TotalAmt) || 0,
      vencimento: item.DueDate || null,
      categoria: null,
      status: Number(item.Balance) === 0 ? 'pago' : 'pendente',
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: contraparteNome,
      contraparte_telefone: null,
      erp_id: `quickbooks:${item.Id}`,
    };
  },
};
