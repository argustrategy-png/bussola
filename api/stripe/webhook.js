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

// Tolerância de 5 min entre o timestamp assinado e agora (a mesma do SDK
// oficial) — sem isso, um evento capturado podia ser reenviado depois.
const TOLERANCIA_S = 300;

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  // O header pode trazer mais de um v1 (durante a troca do segredo do webhook).
  const pares = signatureHeader.split(',').map((p) => p.split('='));
  const t = Number(pares.find(([k]) => k === 't')?.[1]);
  const assinaturas = pares.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !assinaturas.length || Math.abs(Date.now() / 1000 - t) > TOLERANCIA_S) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  return assinaturas.some((v) => {
    const recebida = Buffer.from(v);
    return recebida.length === expected.length && crypto.timingSafeEqual(expected, recebida);
  });
}

async function stripeGet(path) {
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  return resp.json();
}

// Desde a API 2025-03-31.basil, current_period_end saiu do Subscription e
// foi para cada item da assinatura (billing por item, não mais por assinatura inteira).
function currentPeriodEnd(sub) {
  return sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
}

async function updateSubscriberByCustomer(stripeCustomerId, patch) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resp = await fetch(`${supabaseUrl}/rest/v1/subscribers?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}`, {
    method: 'PATCH',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  // Antes a falha era ignorada e o webhook respondia 200: o Stripe não
  // reenviava e o assinante ficava com plano/status errado sem ninguém saber.
  // Lançando aqui, o handler responde 500 e o Stripe tenta de novo.
  if (!resp.ok) throw new Error(`Falha ao atualizar assinante ${stripeCustomerId}: ${resp.status} ${await resp.text()}`);
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
            expira: new Date(currentPeriodEnd(sub) * 1000).toISOString().split('T')[0],
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
          expira: new Date(currentPeriodEnd(sub) * 1000).toISOString().split('T')[0],
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
