// POST /api/stripe/checkout — cria (ou reaproveita) o Customer no Stripe e
// devolve a URL do Checkout Session pra redirecionar o assinante.
// Cobrança começa imediatamente (sem trial_period_days aqui) porque o
// período grátis de 30 dias já é controlado pelo MeuArgus (subscribers.expira).

import { getAuthenticatedSubscriber } from '../_lib/supabase.js';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeHeaders() {
  return {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const subscriberId = await getAuthenticatedSubscriber(req);
  if (!subscriberId) return res.status(401).json({ error: 'não autenticado' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const subResp = await fetch(
    `${supabaseUrl}/rest/v1/subscribers?id=eq.${subscriberId}&select=email,nome,stripe_customer_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const [subscriber] = await subResp.json();
  if (!subscriber) return res.status(404).json({ error: 'assinante_nao_encontrado' });

  try {
    let customerId = subscriber.stripe_customer_id;

    if (!customerId) {
      const custResp = await fetch(`${STRIPE_API}/customers`, {
        method: 'POST',
        headers: stripeHeaders(),
        body: new URLSearchParams({
          email: subscriber.email,
          name: subscriber.nome || '',
          'metadata[subscriber_id]': subscriberId,
        }),
      });
      const customer = await custResp.json();
      if (!custResp.ok) throw new Error(customer.error?.message || 'Falha ao criar customer no Stripe');
      customerId = customer.id;

      await fetch(`${supabaseUrl}/rest/v1/subscribers?id=eq.${subscriberId}`, {
        method: 'PATCH',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      });
    }

    const origin = `https://${req.headers.host}`;
    const sessionResp = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: stripeHeaders(),
      body: new URLSearchParams({
        mode: 'subscription',
        customer: customerId,
        'line_items[0][price]': process.env.STRIPE_PRICE_ID,
        'line_items[0][quantity]': '1',
        success_url: `${origin}/app?checkout=sucesso`,
        cancel_url: `${origin}/app?checkout=cancelado`,
        client_reference_id: subscriberId,
        'metadata[subscriber_id]': subscriberId,
      }),
    });
    const session = await sessionResp.json();
    if (!sessionResp.ok) throw new Error(session.error?.message || 'Falha ao criar checkout session');

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('stripe checkout error', err);
    return res.status(500).json({ error: 'checkout_failed', detail: String(err.message || err) });
  }
}
