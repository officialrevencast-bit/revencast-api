'use strict';

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

async function parseJsonSafe(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFirstName(name, email) {
  const cleanName = String(name || '').trim();
  if (cleanName) return cleanName.split(/\s+/)[0];
  const local = String(email || '').split('@')[0];
  return local || 'there';
}

function buildWelcomeEmailHtml({ name, email }) {
  const firstName = escapeHtml(getFirstName(name, email));
  return `
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:Segoe UI,Arial,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:34px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#1a1e24;border:1px solid rgba(94,211,243,.24);border-radius:20px;overflow:hidden;">
              <tr>
                <td style="padding:30px 30px 20px;background:linear-gradient(135deg,rgba(94,211,243,.18),rgba(22,117,169,.10));">
                  <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#5ed3f3;font-weight:800;">Revencast</div>
                  <h1 style="margin:14px 0 0;font-size:30px;line-height:1.2;color:#ffffff;">Welcome, ${firstName}</h1>
                  <p style="margin:12px 0 0;color:#b0b0b0;font-size:15px;line-height:1.7;">Your Revencast account is ready. You can now validate product ideas with market signals, competitor context, pricing guidance, and execution-focused reports.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 30px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 12px;">
                    <tr>
                      <td style="padding:16px;background:rgba(255,255,255,.045);border:1px solid rgba(94,211,243,.14);border-radius:14px;">
                        <div style="color:#ffffff;font-weight:800;font-size:15px;">Run your first simulation</div>
                        <div style="margin-top:6px;color:#b0b0b0;font-size:14px;line-height:1.6;">Describe your idea, choose a target country, and generate a structured market validation report.</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:16px;background:rgba(255,255,255,.045);border:1px solid rgba(94,211,243,.14);border-radius:14px;">
                        <div style="color:#ffffff;font-weight:800;font-size:15px;">Read evidence-backed sections</div>
                        <div style="margin-top:6px;color:#b0b0b0;font-size:14px;line-height:1.6;">Each report is organized around opportunity, positioning, pricing, financials, risks, and roadmap decisions.</div>
                      </td>
                    </tr>
                  </table>
                  <a href="https://revencast.com/simulation" style="display:inline-block;margin-top:20px;padding:13px 18px;border-radius:14px;background:linear-gradient(135deg,#5ed3f3,#1675a9);color:#0f1215;text-decoration:none;font-weight:900;">Start a simulation</a>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 30px;border-top:1px solid rgba(255,255,255,.08);color:#7f8b99;font-size:12px;line-height:1.6;">
                  You are receiving this because an account was created for ${escapeHtml(email)}. Questions? Contact support@revencast.com.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');
  setCors(res, 'POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = await authorizeRequest(req, res, {
      allowInternalSecret: false,
      allowBearer: true,
      allowAnonymous: false
    });
    if (!auth || !auth.ok) return;

    const RESEND_API_KEY = getEnv('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY is not configured' });
    }

    const email = String(auth.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Authenticated email is required' });

    const displayName = String(req.body?.display_name || '').trim().slice(0, 120);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'User-Agent': 'Revencast/1.0'
      },
      body: JSON.stringify({
        from: 'noreply@revencast.com',
        to: email,
        subject: 'Welcome to Revencast',
        html: buildWelcomeEmailHtml({ name: displayName, email }),
        text: [
          `Welcome to Revencast, ${getFirstName(displayName, email)}.`,
          'Your account is ready.',
          'Start a simulation: https://revencast.com/simulation',
          'Questions? Contact support@revencast.com.'
        ].join('\n')
      })
    });

    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.message || payload?.error || `resend_${response.status}`
      });
    }

    return res.status(200).json({ ok: true, email_id: payload?.id || '' });
  } catch (err) {
    setCors(res, 'POST, OPTIONS');
    return res.status(500).json({ error: 'Welcome email failed', details: err?.message || 'Unknown error' });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };

