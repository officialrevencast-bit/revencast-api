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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
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

function buildReEngageEmailHtml({ name, email, ideaName, ideaDescription, targetCountry, customBody }) {
  const firstName = escapeHtml(getFirstName(name, email));
  const idea = escapeHtml(String(ideaName || 'your idea').trim());
  const description = escapeHtml(String(ideaDescription || '').trim());
  const country = escapeHtml(String(targetCountry || '').trim());
  
  const bodyContent = String(customBody || '').trim();
  
  const defaultBody = bodyContent || `
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.7;">You ran the numbers on <strong style="color:#5ed3f3;">${idea}</strong>. Now see the full picture.</p>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.7;">Your preview showed you the surface — scores, pricing hints, early signals. Locked underneath: the stuff that actually tells you if this idea works.</p>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.7;">Unlock the full report and get:</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 8px;margin:0 0 16px;">
      <tr><td style="padding:6px 0;color:#b0b0b0;font-size:14px;line-height:1.5;">&bull; <strong style="color:#ffffff;">Competitive analysis</strong> — where you win, where you don't</td></tr>
      <tr><td style="padding:6px 0;color:#b0b0b0;font-size:14px;line-height:1.5;">&bull; <strong style="color:#ffffff;">12-month financial projections & breakeven</strong></td></tr>
      <tr><td style="padding:6px 0;color:#b0b0b0;font-size:14px;line-height:1.5;">&bull; <strong style="color:#ffffff;">Execution roadmap</strong> with real KPIs</td></tr>
      <tr><td style="padding:6px 0;color:#b0b0b0;font-size:14px;line-height:1.5;">&bull; <strong style="color:#ffffff;">All 12 sections.</strong> Zero placeholders.</td></tr>
    </table>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.7;">Your inputs are saved. Click, pay, and your complete report generates instantly — no re-entering anything.</p>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.7;">Building more than one idea? Get <strong style="color:#5ed3f3;">5 credits for $9.95</strong> (still $1.99/report) &rarr;</p>
    <p style="margin:0 0 16px;color:#fbbf24;font-size:14px;line-height:1.5;"><strong>Early access pricing won't last — lock in your rate now.</strong></p>
  `;

  return `
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:Segoe UI,Arial,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:34px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#1a1e24;border:1px solid rgba(94,211,243,.24);border-radius:20px;overflow:hidden;">
              
              <!-- Header with Logo -->
              <tr>
                <td style="padding:30px 30px 20px;background:linear-gradient(135deg,rgba(94,211,243,.18),rgba(22,117,169,.10));text-align:center;">
                  <img src="https://www.revencast.com/logo/rbg.png" alt="Revencast" style="height:36px;width:auto;border:0;" />
                  <h1 style="margin:16px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">${firstName}, your full report is one click away</h1>
                </td>
              </tr>
              
              <!-- Body -->
              <tr>
                <td style="padding:28px 30px;">
                  ${defaultBody}
                  
                  <!-- CTA Button -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="center">
                        <a href="https://revencast.com/pricing?return_context=simulation_resume&utm_source=email&utm_medium=reengagement&utm_campaign=preview_upgrade" style="display:inline-block;padding:16px 28px;border-radius:14px;background:linear-gradient(135deg,#5ed3f3,#1675a9);color:#0f1215;text-decoration:none;font-weight:900;font-size:16px;">Unlock Full Report — $1.99 &rarr;</a>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Note -->
                  <p style="margin:18px 0 0;color:#7f8b99;font-size:13px;line-height:1.5;">Your inputs are saved. Click, pay, and your complete report generates instantly — no re-entering anything.</p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="padding:18px 30px;border-top:1px solid rgba(255,255,255,.08);color:#7f8b99;font-size:12px;line-height:1.6;">
                  Questions? <a href="mailto:support@revencast.com" style="color:#5ed3f3;text-decoration:none;">support@revencast.com</a><br />
                  You're getting this because you ran a free preview for "${idea}".
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

    const action = String(req.body?.action || 'welcome').trim();

    // ─── Welcome Email Flow ───
    if (action === 'welcome') {
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
          from: 'Revencast <noreply@revencast.com>',
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
    }

    // ─── Re-engagement Email Flow ───
    if (action === 'reengage') {
      const adminEmails = new Set([
        'nomanromane@gmail.com',
        'armaan2004ahmed@gmail.com',
      ]);
      const adminEmail = String(auth.email || '').trim().toLowerCase();
      if (!adminEmails.has(adminEmail)) {
        return res.status(403).json({ error: 'Only admins can send re-engagement emails' });
      }

      const { recipients, custom_body, subject_line } = req.body || {};
      
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'recipients array is required with at least one recipient' });
      }

      if (recipients.length > 50) {
        return res.status(400).json({ error: 'Cannot send to more than 50 recipients at once' });
      }

      const results = [];
      const errors = [];

      for (const recipient of recipients) {
        const email = String(recipient.email || '').trim().toLowerCase();
        const name = String(recipient.name || '').trim();
        const ideaName = String(recipient.idea_name || '').trim();
        const ideaDescription = String(recipient.product_idea || '').trim();
        const targetCountry = String(recipient.target_country || '').trim();
        const subject = String(subject_line || '').trim()
          .replace(/\{idea\}/g, ideaName || 'your idea')
          .replace(/\{name\}/g, name || getFirstName(name, email))
          .replace(/\{country\}/g, targetCountry || 'your market')
          || `The data on "${ideaName || 'your idea'}" is ready. You just haven't seen it yet.`;

        if (!email) {
          errors.push({ email, error: 'Missing email address' });
          continue;
        }

        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'User-Agent': 'Revencast/1.0'
            },
            body: JSON.stringify({
              from: 'Revencast <noreply@revencast.com>',
              to: email,
              subject: subject,
              html: buildReEngageEmailHtml({
                name,
                email,
                ideaName,
                ideaDescription,
                targetCountry,
                customBody: custom_body || ''
              }),
              text: [
                `${name ? getFirstName(name, email) : 'Hi'},`,
                '',
                `You recently ran a free preview simulation for "${ideaName || 'your idea'}"${targetCountry ? ` targeting the ${targetCountry} market.` : '.'}`,
                '',
                'Your preview gave you a first look at scores and risk signals, but the full report is still locked.',
                '',
                'Unlock your complete market validation report starting at just $1.99 for a single credit.',
                '',
                'What you get:',
                '- Complete competitive analysis with pricing comparison',
                '- 12-month financial projections and breakeven analysis',
                '- Execution roadmap with KPIs and milestones',
                '- All sections fully filled — no placeholders',
                '',
                'Upgrade here: https://revencast.com/pricing',
                '',
                'Your preview data is safely saved. No need to re-enter your idea.',
                '',
                '— Revencast team'
              ].join('\n')
            })
          });

          const payload = await parseJsonSafe(response);
          if (response.ok) {
            results.push({ email, status: 'sent', email_id: payload?.id || '' });
          } else {
            errors.push({
              email,
              error: payload?.message || payload?.error || `resend_${response.status}`
            });
          }
        } catch (err) {
          errors.push({ email, error: err?.message || 'Network error' });
        }
      }

      return res.status(200).json({
        ok: true,
        sent_count: results.length,
        error_count: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    setCors(res, 'POST, OPTIONS');
    return res.status(500).json({ error: 'Email request failed', details: err?.message || 'Unknown error' });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
