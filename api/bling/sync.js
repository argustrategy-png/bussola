// /api/bling/sync — busca contas a pagar/receber no Bling e grava em `lancamentos`
// (origem='erp'). Chamado pelo frontend autenticado (Authorization: Bearer <jwt do usuário>).
//
// ATENÇÃO: o mapeamento de campos da resposta do Bling (bling.data[].*) foi escrito
// com base na documentação pública e pode precisar de ajuste fino após o primeiro
// teste real — os nomes exatos de campo só são 100% confirmados chamando a API ao vivo.

const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const BLING_API = 'https://api.bling.com.br/Api/v3';

async function getAuthenticatedSubscriber(req) {
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return null;

  const resp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!resp.ok) return null;
  const user = await resp.json();
  return user?.id || null;
}

async function getIntegration(subscriberId) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?subscriber_id=eq.${subscriberId}&provider=eq.bling&select=*`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const rows = await resp.json();
  return rows?.[0] || null;
}

async function refreshToken(integration) {
  const basic = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
  const resp = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'Authorization': `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error('Falha ao renovar token do Bling');

  const expiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?id=eq.${integration.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || integration.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  return { ...integration, access_token: data.access_token };
}

async function fetchBlingContas(accessToken, tipo) {
  // tipo: 'pagar' | 'receber'
  const url = `${BLING_API}/contas/${tipo}?pagina=1&limite=100`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Bling contas/${tipo} falhou: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json?.data || [];
}

function mapContaToLancamento(conta, tipo, subscriberId) {
  const contraparte = conta.contato?.nome || conta.contato?.name || null;
  const situacaoId = conta.situacao?.id ?? conta.situacao;
  // Bling: 1 = em aberto, 2 = recebido/pago (convenção comum na v3; validar no teste real)
  const status = situacaoId === 2 || situacaoId === '2' ? 'pago' : 'pendente';

  return {
    subscriber_id: subscriberId,
    tipo,
    descricao: conta.historico || conta.numeroDocumento || `Conta ${tipo} Bling #${conta.id}`,
    valor: Number(conta.valor) || 0,
    vencimento: conta.vencimento || conta.dataVencimento || null,
    categoria: conta.categoria?.descricao || conta.categoria?.nome || null,
    status,
    recorrencia: 'none',
    toc: tipo === 'pagar' ? 'do' : 'na',
    origem: 'erp',
    contraparte,
    contraparte_telefone: conta.contato?.telefone || conta.contato?.celular || null,
    bling_id: String(conta.id),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  let integration = await getIntegration(subscriberId);
  if (!integration) return res.status(404).json({ error: 'bling_nao_conectado' });

  if (new Date(integration.expires_at).getTime() < Date.now() + 60_000) {
    integration = await refreshToken(integration);
  }

  try {
    const [pagar, receber] = await Promise.all([
      fetchBlingContas(integration.access_token, 'pagar'),
      fetchBlingContas(integration.access_token, 'receber'),
    ]);

    const lancamentos = [
      ...pagar.map((c) => mapContaToLancamento(c, 'pagar', subscriberId)),
      ...receber.map((c) => mapContaToLancamento(c, 'receber', subscriberId)),
    ];

    let gravados = 0;
    if (lancamentos.length) {
      const upsertResp = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/lancamentos?on_conflict=bling_id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(lancamentos),
        }
      );
      if (!upsertResp.ok) {
        const errText = await upsertResp.text();
        throw new Error(`Falha ao gravar lançamentos: ${errText}`);
      }
      gravados = lancamentos.length;
    }

    await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes_erp?id=eq.${integration.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ ultima_sincronizacao: new Date().toISOString() }),
    });

    return res.status(200).json({ ok: true, sincronizados: gravados });
  } catch (err) {
    console.error('Bling sync error', err);
    return res.status(500).json({ error: 'sync_failed', detail: String(err.message || err) });
  }
}
