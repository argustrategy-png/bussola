import { handleOAuthCallback } from '../_lib/oauth-callback.js';

export default async function handler(req, res) {
  return handleOAuthCallback('contaazul', req, res);
}
