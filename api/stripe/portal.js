// POST /api/stripe/portal — abre o Customer Portal do Stripe pra quem já é
// assinante trocar cartão, ver faturas ou cancelar, sem precisar de tela
// própria pra isso (o Stripe hospeda tudo).

import { getAuthenticatedSubscriber } from '../_lib/supabase.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const subResp = await fetch(
    `${supabaseUrl}/rest/v1/subscribers?id=eq.${subscriberId}&select=stripe_customer_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const [subscriber] = await subResp.json();
  if (!subscriber?.stripe_customer_id) return res.status(404).json({ error: 'sem_assinatura_stripe' });

  try {
    const origin = `https://${req.headers.host}`;
    const portalResp = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer: subscriber.stripe_customer_id,
        return_url: `${origin}/app`,
      }),
    });
    const portal = await portalResp.json();
    if (!portalResp.ok) throw new Error(portal.error?.message || 'Falha ao abrir o portal do Stripe');

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error('stripe portal error', err);
    return res.status(500).json({ error: 'portal_failed', detail: String(err.message || err) });
  }
}
