'use strict';

const STRIPE_TEST_MODE = false; // Set to true for test mode, false for live mode
const TEST_STRIPE_SECRET_KEY = 'sk_test_51TFcrjI2kzkJOatj17mUcA0JI0M15JtUkiqsdqLekyVDXbL6VyJjSTHhizlw7fejOWw4v9fyNJvpUKm5pPloDwyP00UVscsGxt';

const PLAN_CATALOG = {
  spark: {
    plan_key: 'spark',
    plan_name: 'Single Report',
    product_id: STRIPE_TEST_MODE ? 'prod_UnFpLx9LewhOQ1' : 'prod_UnCo4rcHCD4Kay',
    credits: 1,
    amount_cents: 199,
    currency: 'usd'
  }
};

function calculateCustomAmountCents(reportCount) {
  const count = Math.max(2, Math.min(25, Number.parseInt(reportCount, 10) || 2));
  return Math.round(count * 1.99 * 100);
}

function getPlanFromRequest(body = {}) {
  const planKey = String(body?.plan_key || '').trim().toLowerCase();
  if (PLAN_CATALOG[planKey]) return PLAN_CATALOG[planKey];
  if (planKey !== 'custom') return null;

  const credits = Math.max(2, Math.min(25, Number.parseInt(body?.reports, 10) || 1));
  return {
    plan_key: 'custom',
    plan_name: `Custom (${credits} Reports)`,
    product_id: '',
    product_name: 'Revencast Custom Report Credits',
    product_description: `Generate ${credits} custom product idea validation report${credits === 1 ? '' : 's'}. Each report includes 12 structured analysis sections with detailed business insights.`,
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

function getCheckoutReturnContext(body = {}) {
  const requested = String(body?.return_context || body?.checkout_context || 'default').trim();
  if (requested === 'simulation_resume') {
    const draftId = String(body?.draft_id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return { context: 'simulation_resume', draftId };
  }
  return { context: 'default', draftId: '' };
}

async function parseStripeJson(response) {
  const text = await response.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `stripe_${response.status}` };
  }
}

function buildCheckoutForm({ plan, auth, origin, returnContext, customerEmail, customerName }) {
  const params = new URLSearchParams();
  const successUrl = new URL(`${origin}/pricing`);
  successUrl.searchParams.set('checkout', 'success');
  successUrl.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  if (returnContext?.context === 'simulation_resume') {
    successUrl.searchParams.set('return_context', 'simulation_resume');
    if (returnContext.draftId) successUrl.searchParams.set('draft_id', returnContext.draftId);
  }

  params.set('mode', 'payment');
  params.set('success_url', successUrl.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}'));
  params.set('cancel_url', `${origin}/pricing?checkout=cancelled`);
  params.set('client_reference_id', auth.uid);
  if (customerEmail) params.set('customer_email', customerEmail);
  if (customerName) params.set('customer_creation', 'if_required');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', plan.currency);
  params.set('line_items[0][price_data][unit_amount]', String(plan.amount_cents));
  if (plan.product_id) {
    params.set('line_items[0][price_data][product]', plan.product_id);
  } else {
    params.set('line_items[0][price_data][product_data][name]', plan.product_name || plan.plan_name);
    if (plan.product_description) {
      params.set('line_items[0][price_data][product_data][description]', plan.product_description);
    }
  }
  params.set('metadata[firebase_uid]', auth.uid);
  params.set('metadata[plan_key]', plan.plan_key);
  params.set('metadata[plan_name]', plan.plan_name);
  params.set('metadata[credits]', String(plan.credits));
  params.set('metadata[return_context]', returnContext?.context || 'default');
  if (returnContext?.draftId) params.set('metadata[draft_id]', returnContext.draftId);
  params.set('payment_intent_data[metadata][firebase_uid]', auth.uid);
  params.set('payment_intent_data[metadata][plan_key]', plan.plan_key);
  params.set('payment_intent_data[metadata][credits]', String(plan.credits));
  params.set('payment_intent_data[metadata][return_context]', returnContext?.context || 'default');
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
    const STRIPE_SECRET_KEY = STRIPE_TEST_MODE ? TEST_STRIPE_SECRET_KEY : getEnv('STRIPE_SECRET_KEY');
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe is not configured' });
    }

    const plan = getPlanFromRequest(req.body);
    if (!plan) return res.status(400).json({ error: 'Unknown plan' });

    const origin = getOrigin(req);
    const returnContext = getCheckoutReturnContext(req.body || {});
    const customerEmail = String(req.body?.customer_email || '').trim();
    const customerName = String(req.body?.customer_name || '').trim();
    const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: buildCheckoutForm({ plan, auth, origin, returnContext, customerEmail, customerName })
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
