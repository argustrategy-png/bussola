// POST /api/admin/bling-homologacao  { userId }
// Roda o teste técnico de homologação do Bling (API /homologacao/produtos) usando
// a integração Bling já conectada de `userId`. Só administradores. Só toca nos
// endpoints de homologação do Bling (produto fictício), nunca em dados reais.
//
// Regras do Bling: sequência GET → POST → PUT → PATCH → DELETE, cada resposta traz
// o header x-bling-homologacao que vai no request seguinte; no máximo 10s no total;
// em uma das etapas o access token é invalidado e é preciso renovar com o refresh token.

import { getAuthenticatedSubscriber, getIntegracao, patchIntegracao } from '../_lib/supabase.js';
import { bling } from '../_lib/providers/bling.js';

const API = 'https://api.bling.com.br/Api/v3/homologacao/produtos';
const LIMITE_TOTAL_MS = 10_000;

function serviceHeaders() {
  return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
}

async function isAdmin(userId) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/subscribers?id=eq.${userId}&select=is_admin`, { headers: serviceHeaders() });
  const rows = await resp.json();
  return rows?.[0]?.is_admin === true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const callerId = await getAuthenticatedSubscriber(req);
  if (!callerId) return res.status(401).json({ error: 'não autenticado' });
  if (!(await isAdmin(callerId))) return res.status(403).json({ error: 'apenas_admin' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

  const integracao = await getIntegracao(userId, 'bling');
  if (!integracao) return res.status(404).json({ error: 'bling_nao_conectado' });

  let accessToken = integracao.access_token;
  let refreshToken = integracao.refresh_token;
  let hash = null;
  let renovou = false;
  const passos = [];
  const inicio = Date.now();

  async function renovarToken() {
    const novo = await bling.refreshToken({ refreshToken });
    accessToken = novo.accessToken;
    refreshToken = novo.refreshToken;
    // O Bling rotaciona o refresh token: se não gravar o novo, a integração quebra.
    await patchIntegracao(integracao.id, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + novo.expiresIn * 1000).toISOString(),
    });
    renovou = true;
  }

  async function chamar(nome, metodo, url, body) {
    const t0 = Date.now();
    const montar = () => {
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (hash) headers['x-bling-homologacao'] = hash;
      return { method: metodo, headers, body: body !== undefined ? JSON.stringify(body) : undefined };
    };
    let resp = await fetch(url, montar());
    let renovado = false;
    if (resp.status === 401) {
      await renovarToken();
      renovado = true;
      resp = await fetch(url, montar());
    }
    const texto = await resp.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* resposta sem corpo (ex.: DELETE) */ }
    const novoHash = resp.headers.get('x-bling-homologacao');
    if (novoHash) hash = novoHash;
    passos.push({ passo: nome, status: resp.status, ok: resp.ok, ms: Date.now() - t0, tokenRenovado: renovado, erro: resp.ok ? undefined : texto.slice(0, 300) });
    if (!resp.ok) throw new Error(`${nome} falhou (${resp.status})`);
    return json;
  }

  try {
    // O access token do Bling dura 6h; se já estiver vencido, renova antes de
    // começar pra não gastar o tempo do teste (10s) com isso no meio.
    if (new Date(integracao.expires_at).getTime() < Date.now() + 60_000) await renovarToken();

    const inicial = await chamar('1. GET produto de exemplo', 'GET', API);
    const dados = inicial?.data;
    if (!dados) throw new Error('GET não retornou data');
    const criado = await chamar('2. POST criar produto', 'POST', API, { nome: dados.nome, preco: dados.preco, codigo: dados.codigo });
    const id = criado?.data?.id;
    if (!id) throw new Error('POST não retornou id');
    await chamar('3. PUT alterar produto', 'PUT', `${API}/${id}`, { nome: 'Copo', preco: dados.preco, codigo: dados.codigo });
    await chamar('4. PATCH situação', 'PATCH', `${API}/${id}/situacoes`, { situacao: 'I' });
    await chamar('5. DELETE remover produto', 'DELETE', `${API}/${id}`);

    const totalMs = Date.now() - inicio;
    return res.status(200).json({ ok: true, dentroDoLimite: totalMs <= LIMITE_TOTAL_MS, totalMs, tokenRenovado: renovou, passos });
  } catch (err) {
    console.error('bling homologacao falhou', err.message);
    return res.status(200).json({ ok: false, erro: String(err.message || err), totalMs: Date.now() - inicio, tokenRenovado: renovou, passos });
  }
}
