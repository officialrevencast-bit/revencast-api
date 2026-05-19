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
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'User-Agent': 'Revencast/1.0'
    },
    body: JSON.stringify({
      from: 'noreply@support.revencast.com',
      to: customerEmail,
      subject: 'Payment Confirmation - Revencast Credits Received',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333;">
            <!-- Header with Logo -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Revencast</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Market Validation & Revenue Forecasting</p>
            </div>
      
            <!-- Main Content -->
            <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <h2 style="color: #667eea; margin-bottom: 20px;">Payment Confirmed! 🎉</h2>
              
              <p style="font-size: 16px; margin-bottom: 20px;">
                Thank you for your purchase. Your <strong>${planName || 'credits'}</strong> plan has been activated and credits have been added to your account.
              </p>
      
              <div style="background: #f8f9ff; border-left: 4px solid #667eea; padding: 20px; margin: 30px 0; border-radius: 4px;">
                <p style="margin: 0; color: #667eea; font-weight: 600;">You can now:</p>
                <ul style="margin: 15px 0 0 0; padding-left: 20px;">
                  <li style="margin-bottom: 8px;">Generate unlimited market validation reports</li>
                  <li style="margin-bottom: 8px;">Access AI-powered competitive analysis</li>
                  <li style="margin-bottom: 8px;">Get real-time trend data and insights</li>
                </ul>
              </div>
      
              <!-- CTA Button -->
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://revencast.com/dashboard" style="background: #667eea; color: white; padding: 12px 40px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  Go to Dashboard
                </a>
              </div>
      
              <p style="font-size: 14px; color: #666; margin-top: 30px;">
                If you have any questions, feel free to reach out to our support team at <a href="mailto:support@revencast.com" style="color: #667eea; text-decoration: none;">support@revencast.com</a>
              </p>
            </div>
      
            <!-- Footer -->
            <div style="background: #f8f9fa; padding: 30px 20px; text-align: center; border-top: 1px solid #eee; font-size: 12px; color: #999;">
              <p style="margin: 0 0 15px 0;">
                <a href="https://revencast.com" style="color: #667eea; text-decoration: none; margin: 0 15px;">Website</a>
                <a href="https://twitter.com/revencast" style="color: #667eea; text-decoration: none; margin: 0 15px;">Twitter</a>
                <a href="https://linkedin.com/company/revencast" style="color: #667eea; text-decoration: none; margin: 0 15px;">LinkedIn</a>
              </p>
              <p style="margin: 0;">© 2026 Revencast. All rights reserved.</p>
            </div>
          </body>
        </html>
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
      payment_status: session.payment_status || 'unpaid'
    });
  }

  const row = existing || await getCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId);
  const alreadyCredited = Boolean(row?.credited_at);
  let creditResult = null;
  if (!alreadyCredited) {
    creditResult = await grantSupabaseCredits(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, session);
  }

  await updateCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId, {
    status: 'paid',
    payment_status: session.payment_status || 'paid',
    paid_at: new Date().toISOString(),
    credited_at: alreadyCredited ? row.credited_at : new Date().toISOString()
  });

  // Send confirmation email (idempotent - only send once per session)
  const alreadyEmailed = Boolean(row?.email_sent_at);
  if (!alreadyEmailed) {
    const customerEmail = String(session?.customer_details?.email || '').trim();
    const planName = String(metadata.plan_name || 'credits');
    if (customerEmail) {
      try {
        await sendConfirmationEmail(customerEmail, planName);
        try {
          await updateCheckoutRow(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId, {
            email_sent_at: new Date().toISOString()
          });
        } catch (updateErr) {
          // If email_sent_at column doesn't exist yet, just log and continue
          console.error('Could not update email_sent_at (column may not exist yet):', updateErr?.message || updateErr);
        }
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
    payment_status: session.payment_status || status
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
