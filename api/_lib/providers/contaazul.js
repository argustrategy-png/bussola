// Adaptador ContaAzul — segue o mesmo formato do bling.js.
//
// ⚠️ PENDENTE DE CONFIGURAÇÃO:
//   1. Criar um app em https://developers.contaazul.com (App Center Conta Azul)
//   2. Registrar o redirect URI: https://meuargus.com/api/contaazul/callback
//   3. Adicionar no Vercel: CONTAAZUL_CLIENT_ID, CONTAAZUL_CLIENT_SECRET
//
// O endpoint exato de LISTAGEM de contas a pagar/receber (fetchContas abaixo)
// não foi 100% confirmado na documentação pública — o endpoint de detalhe por
// parcela é GET /v1/financeiro/eventos-financeiros/parcelas/{id}, mas a rota
// de listagem precisa ser validada com uma conta de teste real antes de usar
// em produção. Ajuste conforme necessário.

const TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';
const AUTHORIZE_URL = 'https://api.contaazul.com/auth/authorize';
const API_BASE = 'https://api.contaazul.com/v1';

export const contaazul = {
  name: 'contaazul',
  label: 'Conta Azul',
  authType: 'oauth2',

  authorizeUrl({ state, redirectUri }) {
    const clientId = process.env.CONTAAZUL_CLIENT_ID;
    return `${AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=sales&state=${encodeURIComponent(state)}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const basic = Buffer.from(`${process.env.CONTAAZUL_CLIENT_ID}:${process.env.CONTAAZUL_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`ContaAzul exchangeCode falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in || 3600 };
  },

  async refreshToken({ refreshToken }) {
    const basic = Buffer.from(`${process.env.CONTAAZUL_CLIENT_ID}:${process.env.CONTAAZUL_CLIENT_SECRET}`).toString('base64');
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(`ContaAzul refreshToken falhou: ${JSON.stringify(data)}`);
    return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken, expiresIn: data.expires_in || 3600 };
  },

  // TODO: confirmar o endpoint que retorna CNPJ/identificador da conta ContaAzul.
  async fetchAccountId({ accessToken }) {
    throw new Error('contaazul.fetchAccountId ainda não implementado — confirmar endpoint de dados da empresa.');
  },

  // TODO: confirmar o endpoint de listagem (este é um placeholder).
  async fetchContas({ accessToken, tipo }) {
    throw new Error('contaazul.fetchContas ainda não implementado — confirmar endpoint de listagem de eventos financeiros.');
  },

  mapConta(item, tipo, subscriberId) {
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: item.descricao || `Conta ${tipo} ContaAzul #${item.id}`,
      valor: Number(item.valor) || 0,
      vencimento: item.vencimento || null,
      categoria: item.categoria?.nome || null,
      status: item.situacao === 'PAGO' || item.situacao === 'RECEBIDO' ? 'pago' : 'pendente',
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: item.cliente?.nome || item.fornecedor?.nome || null,
      contraparte_telefone: null,
      erp_id: `contaazul:${item.id}`,
    };
  },
};
