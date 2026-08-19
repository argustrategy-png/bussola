// Adaptador Bling — referência para os outros adaptadores (contaazul.js, quickbooks.js, omie.js).
// Cada adaptador OAuth2 exporta: authType, authorizeUrl(), exchangeCode(), refreshToken(),
// fetchAccountId(), fetchContas(), mapConta().

const TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const EMPRESAS_URL = 'https://api.bling.com.br/Api/v3/empresas/me/dados-basicos';
const API_BASE = 'https://api.bling.com.br/Api/v3';

export const bling = {
  name: 'bling',
  label: 'Bling',
  authType: 'oauth2',

  authorizeUrl({ state, redirectUri }) {
    const clientId = process.env.BLING_CLIENT_ID;
    return `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`Bling exchangeCode falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in || 21600 };
  },

  async refreshToken({ refreshToken }) {
    const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '1.0',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`Bling refreshToken falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 21600 };
  },

  // Identificador estável da empresa no Bling (CNPJ) — usado pra travar 1 Bling = 1 conta MeuArgus.
  async fetchAccountId({ accessToken }) {
    const resp = await fetch(EMPRESAS_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Bling /empresas falhou: ${resp.status} ${text}`);
    }
    const json = await resp.json();
    const empresa = json?.data?.[0] || json?.data || json;
    const cnpj = empresa?.cnpj || empresa?.documento;
    if (!cnpj) throw new Error('Bling /empresas não retornou CNPJ');
    return cnpj;
  },

  async fetchContas({ accessToken, tipo }) {
    const resp = await fetch(`${API_BASE}/contas/${tipo}?pagina=1&limite=100`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Bling contas/${tipo} falhou: ${resp.status} ${await resp.text()}`);
    const json = await resp.json();
    return json?.data || [];
  },

  // Confirmado contra o OpenAPI oficial do Bling (ContasDadosBaseDTO): a
  // listagem só traz id/situacao/vencimento/valor/contato.id — sem nome do
  // contato, categoria ou histórico. Pra trazer o nome do contato seria
  // preciso um GET /contatos/{id} por lançamento (não implementado ainda,
  // por custo de N chamadas extra por sincronização).
  mapConta(conta, tipo, subscriberId) {
    // situacao: 1 Aberto, 2 Pago, 3 Parcial, 4 Devolvido, 5 Cancelado, 6 Devolvido parcial, 7 Confirmado
    const status = conta.situacao === 2 ? 'pago' : 'pendente';
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: `Conta ${tipo === 'pagar' ? 'a pagar' : 'a receber'} Bling #${conta.id}`,
      valor: Number(conta.valor) || 0,
      vencimento: conta.vencimento || null,
      categoria: null,
      status,
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: conta.contato?.id ? `Contato Bling #${conta.contato.id}` : null,
      contraparte_telefone: null,
      erp_id: `bling:${conta.id}`,
    };
  },
};
