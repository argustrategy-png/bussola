// `state` assinado do OAuth2 dos ERPs. Antes o state era só o id do
// assinante: qualquer um podia montar um link de autorização com o próprio
// id e mandar pra vítima — ao autorizar, o ERP da vítima ficava ligado à
// conta de quem mandou o link. Agora:
//  - o state é emitido pelo servidor (POST /api/erp/status) e assinado com
//    HMAC, com validade curta e amarrado ao provider;
//  - o mesmo pedido grava um cookie HttpOnly com um nonce que também vai
//    dentro do state. No callback, o nonce do state precisa bater com o do
//    cookie — só o navegador que iniciou a conexão tem esse cookie.

import crypto from 'node:crypto';

const VALIDADE_MS = 15 * 60 * 1000;
export const COOKIE_NONCE = 'meuargus_oauth_nonce';

function chave() {
  const base = process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('Sem segredo para assinar o state do OAuth');
  return crypto.createHash('sha256').update(`meuargus-oauth-state:${base}`).digest();
}

const assinar = (payload) => crypto.createHmac('sha256', chave()).update(payload).digest('base64url');

export function criarState(subscriberId, provider) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = Buffer.from(JSON.stringify({ s: subscriberId, p: provider, e: Date.now() + VALIDADE_MS, n: nonce })).toString('base64url');
  return { state: `${payload}.${assinar(payload)}`, nonce };
}

export function cookieNonce(nonce) {
  return `${COOKIE_NONCE}=${nonce}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${VALIDADE_MS / 1000}`;
}

export const cookieNonceApagar = () => `${COOKIE_NONCE}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function lerCookie(req, nome) {
  const par = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${nome}=`));
  return par ? par.slice(nome.length + 1) : null;
}

// Devolve o subscriberId se o state for válido para este provider e este navegador; senão null.
export function validarState(req, state, provider) {
  if (typeof state !== 'string') return null;
  const [payload, assinatura] = state.split('.');
  if (!payload || !assinatura) return null;
  const esperado = Buffer.from(assinar(payload));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;

  let dados;
  try { dados = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (dados?.p !== provider || !(dados.e > Date.now()) || typeof dados.s !== 'string') return null;

  const nonceCookie = lerCookie(req, COOKIE_NONCE);
  if (!nonceCookie || nonceCookie !== dados.n) return null;
  return dados.s;
}
