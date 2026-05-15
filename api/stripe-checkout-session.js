'use strict';

const PLAN_CATALOG = {
  spark: {
    plan_key: 'spark',
    plan_name: 'Spark',
    product_id: 'prod_UWNdEx4NQQo4qE',
    credits: 1,
    amount_cents: 1999,
    currency: 'usd'
  },
  ignite: {
    plan_key: 'ignite',
    plan_name: 'Ignite',
    product_id: 'prod_UWNeuxQtilOGUu',
    credits: 3,
    amount_cents: 2999,
    currency: 'usd'
  },
  blaze: {
    plan_key: 'blaze',
    plan_name: 'Blaze',
    product_id: 'prod_UWNhKLHlbi6Z3H',
    credits: 10,
    amount_cents: 4999,
    currency: 'usd'
  }
};

function calculateCustomAmountCents(reportCount) {
  const count = Math.max(1, Math.min(25, Number.parseInt(reportCount, 10) || 1));
  if (count === 1) return 1999;
  if (count === 2) return 2499;
  if (count === 3) return 2999;
  if (count > 3 && count < 10) {
    return Math.round((29.99 + ((49.99 - 29.99) / 7) * (count - 3)) * 100);
  }
  return Math.round(4.999 * count * 100);
}

function getPlanFromRequest(body = {}) {
  const planKey = String(body?.plan_key || '').trim().toLowerCase();
  if (PLAN_CATALOG[planKey]) return PLAN_CATALOG[planKey];
  if (planKey !== 'custom') return null;

  const credits = Math.max(1, Math.min(25, Number.parseInt(body?.reports, 10) || 1));
  return {
    plan_key: 'custom',
    plan_name: `Custom (${credits} Reports)`,
    product_id: '',
    product_name: 'Revencast Custom Report Credits',
    credits,
    amount_cents: calculateCustomAmountCents(credits),
    currency: 'usd'
  };
}

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function getSupabaseHeaders(serviceRoleKey, prefer = '') {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

function getOrigin(req) {
  const raw = String(req.headers.origin || '').trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').trim();
  return host ? `${proto}://${host}` : 'https://www.revencast.com';
}

async function parseStripeJson(response) {
  const text = await response.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `stripe_${response.status}` };
  }
}

function buildCheckoutForm({ plan, auth, origin }) {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/pricing?checkout=cancelled`);
  params.set('client_reference_id', auth.uid);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', plan.currency);
  params.set('line_items[0][price_data][unit_amount]', String(plan.amount_cents));
  if (plan.product_id) {
    params.set('line_items[0][price_data][product]', plan.product_id);
  } else {
    params.set('line_items[0][price_data][product_data][name]', plan.product_name || plan.plan_name);
  }
  params.set('metadata[firebase_uid]', auth.uid);
  params.set('metadata[plan_key]', plan.plan_key);
  params.set('metadata[plan_name]', plan.plan_name);
  params.set('metadata[credits]', String(plan.credits));
  params.set('payment_intent_data[metadata][firebase_uid]', auth.uid);
  params.set('payment_intent_data[metadata][plan_key]', plan.plan_key);
  params.set('payment_intent_data[metadata][credits]', String(plan.credits));
  return params;
}

async function savePendingSession({ session, plan, auth }) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const row = {
    stripe_session_id: session.id,
    firebase_uid: auth.uid,
    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
    product_id: plan.product_id,
    credits: plan.credits,
    amount_cents: plan.amount_cents,
    currency: plan.currency,
    status: 'pending',
    payment_status: session.payment_status || 'unpaid',
    checkout_url: session.url || null,
    raw_session: session
  };

  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/stripe_checkout_sessions`, {
    method: 'POST',
    headers: getSupabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=minimal'),
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `supabase_${response.status}`);
  }
}

module.exports = async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');
  setCors(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  try {
    const STRIPE_SECRET_KEY = getEnv('STRIPE_SECRET_KEY');
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured' });
    }

    const plan = getPlanFromRequest(req.body);
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });

    const origin = getOrigin(req);
    const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: buildCheckoutForm({ plan, auth, origin })
    });

    const session = await parseStripeJson(stripeResp);
    if (!stripeResp.ok) {
      return res.status(502).json({
        error: session?.error?.message || session?.error || `stripe_${stripeResp.status}`
      });
    }

    await savePendingSession({ session, plan, auth });
    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unable to create checkout session' });
  }
};
