'use strict';

const crypto = require('crypto');

const EVENT_TOLERANCE_SECONDS = 300;

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function supabaseHeaders(serviceRoleKey, prefer = '') {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;

  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = String(signatureHeader || '').split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (!key || !value) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});

  const timestamp = Number(parts.t?.[0] || 0);
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > EVENT_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return signatures.some((sig) => {
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(sig, 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

async function parseJsonSafe(response) {
  const text = await response.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}

async function getCheckoutRow(supabaseUrl, serviceKey, sessionId) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/stripe_checkout_sessions?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=*`,
    { headers: supabaseHeaders(serviceKey) }
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `supabase_${response.status}`);
  return Array.isArray(payload) ? payload[0] : null;
}

async function upsertCheckoutRow(supabaseUrl, serviceKey, row) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/stripe_checkout_sessions?on_conflict=stripe_session_id`,
    {
      method: 'POST',
      headers: supabaseHeaders(serviceKey, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(row)
    }
  );
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    throw new Error(payload?.message || payload?.error || `supabase_${response.status}`);
  }
}

async function updateCheckoutRow(supabaseUrl, serviceKey, sessionId, updates) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/stripe_checkout_sessions?stripe_session_id=eq.${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=minimal'),
      body: JSON.stringify(updates)
    }
  );
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    throw new Error(payload?.message || payload?.error || `supabase_${response.status}`);
  }
}

async function grantSupabaseCredits(supabaseUrl, serviceKey, session) {
  const metadata = session.metadata || {};
  const uid = String(metadata.firebase_uid || session.client_reference_id || '').trim();
  const credits = Math.max(0, Math.floor(Number(metadata.credits || 0)));
  if (!uid || !credits) throw new Error('Missing checkout metadata');

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/grant_report_credits`, {
    method: 'POST',
    headers: supabaseHeaders(serviceKey),
    body: JSON.stringify({
      p_firebase_uid: uid,
      p_credits: credits,
      p_plan_key: String(metadata.plan_key || ''),
      p_plan_name: String(metadata.plan_name || ''),
      p_session_id: String(session.id || ''),
      p_metadata: {
        amount_total: session.amount_total || null,
        currency: session.currency || null,
        payment_intent: session.payment_intent || null,
        customer: session.customer || null
      }
    })
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `supabase_credit_${response.status}`);
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function logWebhookEvent(supabaseUrl, serviceKey, event, status, error = '') {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/stripe_webhook_events?on_conflict=event_id`,
    {
      method: 'POST',
      headers: supabaseHeaders(serviceKey, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        status,
        error: error ? String(error).slice(0, 1000) : null,
        raw_event: event,
        processed_at: new Date().toISOString()
      })
    }
  );
  if (!response.ok) {
    const payload = await parseJsonSafe(response);
    throw new Error(payload?.message || payload?.error || `supabase_event_${response.status}`);
  }
}

async function sendConfirmationEmail(customerEmail, planName) {
  const RESEND_API_KEY = getEnv('RESEND_API_KEY');
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'noreply@support.revencast.com',
      to: customerEmail,
      subject: 'Payment Confirmation - Revencast Credits Received',
      html: `
        <h2>Payment Confirmed!</h2>
        <p>Thank you for your purchase.</p>
        <p>Your <strong>${planName || 'credits'}</strong> plan has been activated and credits have been added to your account.</p>
        <p>You can now use your credits to generate market validation reports on Revencast.</p>
        <p>If you have any questions, feel free to contact our support team.</p>
        <br>
        <p>Best regards,<br>The Revencast Team</p>
      `
    })
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `resend_${response.status}`);
  }
  return payload;
}

async function handleCheckoutPaid(session) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  const sessionId = String(session?.id || '').trim();
  if (!sessionId) throw new Error('Missing checkout session id');

  const metadata = session.metadata || {};
  const uid = String(metadata.firebase_uid || session.client_reference_id || '').trim();
  const credits = Math.max(0, Math.floor(Number(metadata.credits || 0)));
  if (!uid || !credits) throw new Error('Missing checkout metadata');

  const existing = await getCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId);
  if (!existing) {
    await upsertCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      stripe_session_id: sessionId,
      firebase_uid: uid,
      plan_key: String(metadata.plan_key || ''),
      plan_name: String(metadata.plan_name || ''),
      credits,
      amount_cents: Number(session.amount_total || 0),
      currency: String(session.currency || 'usd'),
      status: 'pending',
      payment_status: session.payment_status || 'unpaid',
      raw_session: session
    });
  }

  const row = existing || await getCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId);
  const alreadyCredited = Boolean(row?.credited_at);
  let creditResult = null;
  if (!alreadyCredited) {
    creditResult = await grantSupabaseCredits(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session);
  }

  await updateCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId, {
    firebase_uid: uid,
    status: 'paid',
    payment_status: session.payment_status || 'paid',
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_customer_id: session.customer || null,
    paid_at: new Date().toISOString(),
    credited_at: alreadyCredited ? row.credited_at : new Date().toISOString(),
    credits_balance_after: creditResult?.credits_balance ?? row?.credits_balance_after ?? null,
    raw_session: session
  });

  // Send confirmation email (idempotent - only send once per session)
  const alreadyEmailed = Boolean(row?.email_sent_at);
  if (!alreadyEmailed) {
    const customerEmail = String(session?.customer_details?.email || '').trim();
    const planName = String(metadata.plan_name || 'credits');
    if (customerEmail) {
      try {
        await sendConfirmationEmail(customerEmail, planName);
        await updateCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId, {
          email_sent_at: new Date().toISOString()
        });
      } catch (emailErr) {
        // Log email error but don't fail the entire webhook - credits are already granted
        console.error('Failed to send confirmation email:', emailErr?.message || emailErr);
      }
    }
  }
}

async function handleCheckoutStatus(session, status) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const sessionId = String(session?.id || '').trim();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !sessionId) return;
  await updateCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId, {
    status,
    payment_status: session.payment_status || status,
    raw_session: session
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const STRIPE_WEBHOOK_SECRET = getEnv('STRIPE_WEBHOOK_SECRET');
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).json({ error: 'Stripe webhook is not configured' });

  let event;
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).json({ error: 'Invalid Stripe signature' });
    }
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Invalid webhook payload' });
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await handleCheckoutPaid(event.data.object);
    } else if (event.type === 'checkout.session.expired') {
      await handleCheckoutStatus(event.data.object, 'expired');
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await handleCheckoutStatus(event.data.object, 'failed');
    }

    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      await logWebhookEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, event, 'processed');
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    try {
      const SUPABASE_URL = getEnv('SUPABASE_URL');
      const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        await logWebhookEvent(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, event, 'failed', err?.message || err);
      }
    } catch {
      // Webhook processing errors are returned below; audit-log failures are best effort.
    }
    return res.status(500).json({ error: err?.message || 'Webhook processing failed' });
  }
};
