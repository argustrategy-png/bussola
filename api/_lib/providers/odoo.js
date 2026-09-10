// Adaptador Odoo — usa a API externa via JSON-RPC (common.login + object.execute_kw),
// documentada e estável entre versões do Odoo (on-premise ou Odoo Online).
//
// Diferente do Bling/ContaAzul/QuickBooks, o Odoo não tem redirect OAuth2: a
// conexão é por credenciais que o usuário informa direto (igual Omie), só que
// aqui são 4 campos em vez de 2 — url da instância, nome do banco de dados,
// usuário (e-mail) e API key (ou senha):
//   { url, db, username, apiKey }
//
// `credentialFields` abaixo descreve os 4 campos pro connect-apikey.js
// genérico validar e guardar em `integracoes_erp.credentials` (jsonb) — ver
// migração em supabase-migration-odoo.sql.
//
// ⚠️ As chamadas abaixo (search_read em account.move/res.company) seguem a
// API padrão do Odoo 15+, mas os nomes de campo (ex.: payment_state) podem
// variar em customizações — se a sincronização vier vazia ou com erro,
// confirmar esses nomes no Odoo conectado.

async function odooCall({ url, service, method, args }) {
  const resp = await fetch(`${url.replace(/\/+$/, '')}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`Odoo ${service}.${method} falhou: ${data.error.data?.message || data.error.message || JSON.stringify(data.error)}`);
  return data.result;
}

async function odooAuthenticate({ url, db, username, apiKey }) {
  const uid = await odooCall({ url, service: 'common', method: 'login', args: [db, username, apiKey] });
  if (!uid) throw new Error('Odoo: usuário ou API key inválidos.');
  return uid;
}

async function odooExecuteKw({ url, db, username, apiKey, uid, model, method, args, kwargs }) {
  return odooCall({ url, service: 'object', method: 'execute_kw', args: [db, uid, apiKey, model, method, args, kwargs || {}] });
}

export const odoo = {
  name: 'odoo',
  label: 'Odoo',
  authType: 'apikey',
  credentialFields: [
    { name: 'url', label: 'URL da instância (ex.: https://suaempresa.odoo.com)' },
    { name: 'db', label: 'Banco de dados' },
    { name: 'username', label: 'Usuário (e-mail)' },
    { name: 'apiKey', label: 'API Key' },
  ],

  // Confirma as credenciais e devolve um identificador estável da empresa
  // (CNPJ/VAT) pra travar 1 Odoo = 1 conta MeuArgus.
  async fetchAccountId({ url, db, username, apiKey }) {
    const uid = await odooAuthenticate({ url, db, username, apiKey });
    const empresas = await odooExecuteKw({
      url, db, username, apiKey, uid,
      model: 'res.company', method: 'search_read',
      args: [[], ['vat', 'name']], kwargs: { limit: 1 },
    });
    const empresa = empresas?.[0];
    return empresa?.vat || `${db}:${uid}`;
  },

  // account.move cobre fatura de fornecedor (in_invoice/in_refund, = a pagar)
  // e fatura de cliente (out_invoice/out_refund, = a receber).
  async fetchContas({ url, db, username, apiKey, tipo }) {
    const uid = await odooAuthenticate({ url, db, username, apiKey });
    const moveTypes = tipo === 'pagar' ? ['in_invoice', 'in_refund'] : ['out_invoice', 'out_refund'];
    return odooExecuteKw({
      url, db, username, apiKey, uid,
      model: 'account.move', method: 'search_read',
      args: [
        [['move_type', 'in', moveTypes], ['state', '=', 'posted']],
        ['name', 'ref', 'amount_total', 'invoice_date_due', 'payment_state', 'partner_id'],
      ],
      kwargs: { limit: 200 },
    });
  },

  mapConta(item, tipo, subscriberId) {
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: item.ref || item.name || `Conta ${tipo} Odoo #${item.id}`,
      valor: Number(item.amount_total) || 0,
      vencimento: item.invoice_date_due || null,
      categoria: null,
      status: item.payment_state === 'paid' || item.payment_state === 'in_payment' ? 'pago' : 'pendente',
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: Array.isArray(item.partner_id) ? item.partner_id[1] : null,
      contraparte_telefone: null,
      erp_id: `odoo:${item.id}`,
    };
  },
};
