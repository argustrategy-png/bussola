// Adaptador Omie — DIFERENTE dos outros três: a Omie não usa OAuth2 com
// redirecionamento. A autenticação é por App Key + App Secret, que o próprio
// usuário copia do painel dele (Configurações > Aplicativos) e cola direto no
// MeuArgus. Por isso authType é 'apikey', não 'oauth2', e não existe
// api/omie/callback.js — a conexão acontece via api/erp/connect-apikey.js.
//
// ⚠️ PENDENTE DE CONFIGURAÇÃO: nada a configurar no MeuArgus/Vercel — cada
// usuário usa a própria App Key/Secret. Só precisa terminar de validar os
// endpoints exatos de listagem abaixo com uma conta de teste real.

const API_BASE = 'https://app.omie.com.br/api/v1';

async function omieCall({ appKey, appSecret, path, call, param }) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
  });
  const data = await resp.json();
  if (!resp.ok || data.faultstring) throw new Error(`Omie ${call} falhou: ${data.faultstring || resp.status}`);
  return data;
}

export const omie = {
  name: 'omie',
  label: 'Omie',
  authType: 'apikey',

  // Confirma que App Key/Secret são válidos e retorna um identificador estável
  // da conta (CNPJ da empresa) pra travar 1 Omie = 1 conta MeuArgus.
  async fetchAccountId({ appKey, appSecret }) {
    const data = await omieCall({
      appKey, appSecret,
      path: '/geral/empresas/',
      call: 'ListarEmpresas',
      param: { pagina: 1, registros_por_pagina: 1 },
    });
    const empresa = data?.empresas_cadastro?.[0];
    if (!empresa?.cnpj_empresa) throw new Error('Omie não retornou CNPJ da empresa.');
    return empresa.cnpj_empresa;
  },

  // TODO: validar os nomes exatos dos campos de retorno com uma conta de teste real.
  async fetchContas({ appKey, appSecret, tipo }) {
    const path = tipo === 'pagar' ? '/financas/contapagar/' : '/financas/contareceber/';
    const call = tipo === 'pagar' ? 'ListarContasPagar' : 'ListarContasReceber';
    const data = await omieCall({
      appKey, appSecret, path, call,
      param: { pagina: 1, registros_por_pagina: 100 },
    });
    return data?.conta_pagar_cadastro || data?.conta_receber_cadastro || [];
  },

  mapConta(item, tipo, subscriberId) {
    return {
      subscriber_id: subscriberId,
      tipo,
      descricao: item.observacao || item.numero_documento || `Conta ${tipo} Omie #${item.codigo_lancamento_omie}`,
      valor: Number(item.valor_documento) || 0,
      vencimento: item.data_vencimento || null,
      categoria: null,
      status: item.status_titulo === 'RECEBIDO' || item.status_titulo === 'PAGO' ? 'pago' : 'pendente',
      recorrencia: 'none',
      toc: tipo === 'pagar' ? 'do' : 'na',
      origem: 'erp',
      contraparte: item.nome_cliente || item.nome_fornecedor || null,
      contraparte_telefone: null,
      erp_id: `omie:${item.codigo_lancamento_omie}`,
    };
  },
};
