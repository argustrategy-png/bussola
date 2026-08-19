// POST /api/stripe/webhook — mantém subscribers.plano/status/expira em sincronia
// com o que acontece no Stripe. Verifica a assinatura manualmente (sem o SDK
// do Stripe, pra não precisar de build step neste projeto).

import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

async function stripeGet(path) {
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return resp.json();
}

async function updateSubscriberByCustomer(stripeCustomerId, patch) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${supabaseUrl}/rest/v1/subscribers?stripe_customer_id=eq.${stripeCustomerId}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];
  if (!verifySignature(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).send('Assinatura inválida');
  }

  const event = JSON.parse(rawBody.toString());

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const sub = await stripeGet(`/subscriptions/${session.subscription}`);
          await updateSubscriberByCustomer(session.customer, {
            plano: 'pro',
            status: 'ativo',
            stripe_subscription_id: sub.id,
            expira: new Date(sub.current_period_end * 1000).toISOString().split('T')[0],
          });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status === 'active' || sub.status === 'trialing' ? 'ativo'
          : sub.status === 'past_due' ? 'ativo' // ainda dá acesso durante retentativa de cobrança
          : 'expirado';
        await updateSubscriberByCustomer(sub.customer, {
          status,
          expira: new Date(sub.current_period_end * 1000).toISOString().split('T')[0],
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await updateSubscriberByCustomer(sub.customer, { status: 'expirado', plano: 'free' });
        break;
      }
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe webhook error', event.type, err);
    return res.status(500).json({ error: 'webhook_handler_failed' });
  }
}
