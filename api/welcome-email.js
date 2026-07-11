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
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Revencast account is ready — run your first market validation simulation.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:34px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#1a1e24;border:1px solid rgba(94,211,243,.24);border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45),0 0 0 1px rgba(94,211,243,.05);">
              <tr>
                <td style="height:4px;background:linear-gradient(90deg,#5ed3f3,#1675a9,#5ed3f3);"></td>
              </tr>
              <tr>
                <td style="padding:36px 36px 26px;background:radial-gradient(circle at 15% 0%,rgba(94,211,243,.20),transparent 55%),linear-gradient(135deg,rgba(94,211,243,.14),rgba(22,117,169,.08));border-bottom:1px solid rgba(255,255,255,.06);">
                  <img src="https://www.revencast.com/logo/rbg.png" alt="Revencast" style="height:28px;width:auto;border:0;display:block;" />
                  <h1 style="margin:18px 0 0;font-size:30px;line-height:1.25;color:#ffffff;font-weight:800;letter-spacing:-.01em;">Welcome, ${firstName}</h1>
                  <p style="margin:12px 0 0;color:#b8c0c9;font-size:15px;line-height:1.75;max-width:480px;">Your Revencast account is ready. You can now validate product ideas with market signals, competitor context, pricing guidance, and execution-focused reports.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 36px 34px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 12px;">
                    <tr>
                      <td style="padding:18px 18px 18px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(94,211,243,.16);border-radius:14px;">
                        <table role="presentation" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" style="padding-right:14px;">
                              <div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#5ed3f3,#1675a9);text-align:center;line-height:30px;font-size:15px;"></div>
                            </td>
                            <td>
                              <div style="color:#ffffff;font-weight:800;font-size:15px;">Run your first simulation</div>
                              <div style="margin-top:6px;color:#b0b0b0;font-size:14px;line-height:1.6;">Describe your idea, choose a target country, and generate a structured market validation report.</div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 18px 18px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(94,211,243,.16);border-radius:14px;">
                        <table role="presentation" cellspacing="0" cellpadding="0">
                          <tr>
                            <td valign="top" style="padding-right:14px;">
                              <div style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#5ed3f3,#1675a9);text-align:center;line-height:30px;font-size:15px;"></div>
                            </td>
                            <td>
                              <div style="color:#ffffff;font-weight:800;font-size:15px;">Read evidence-backed sections</div>
                              <div style="margin-top:6px;color:#b0b0b0;font-size:14px;line-height:1.6;">Each report is organized around opportunity, positioning, pricing, financials, risks, and roadmap decisions.</div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;">
                    <tr>
                      <td>
                        <a href="https://revencast.com/simulation" style="display:inline-block;padding:14px 24px;border-radius:14px;background:linear-gradient(135deg,#5ed3f3,#1675a9);color:#0f1215;text-decoration:none;font-weight:900;font-size:15px;box-shadow:0 10px 24px rgba(94,211,243,.25);">Start a simulation &rarr;</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);color:#7f8b99;font-size:12px;line-height:1.6;">
                  You are receiving this because an account was created for ${escapeHtml(email)}. Questions? Contact <a href="mailto:support@revencast.com" style="color:#5ed3f3;text-decoration:none;">support@revencast.com</a>.
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
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">You ran the numbers on <strong style="color:#5ed3f3;">${idea}</strong>. Now see the full picture.</p>
    <p style="margin:0 0 22px;color:#d0d0d0;font-size:15px;line-height:1.75;">Your preview showed you the surface — scores, pricing hints, early signals. Locked underneath: the stuff that actually tells you if this idea works.</p>

    <div style="margin:0 0 22px;padding:2px;border-radius:16px;background:linear-gradient(135deg,rgba(94,211,243,.35),rgba(22,117,169,.15));">
      <div style="padding:20px;border-radius:14px;background:#171b20;">
        <div style="margin:0 0 14px;color:#8fe3fb;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;">Unlock the full report and get</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
          <tr>
            <td width="34" valign="top">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(94,211,243,.15);border:1px solid rgba(94,211,243,.4);text-align:center;line-height:24px;color:#5ed3f3;font-size:13px;font-weight:900;">✓</div>
            </td>
            <td style="color:#e6e9ec;font-size:14px;line-height:1.6;padding-left:2px;"><strong style="color:#ffffff;">Competitive analysis</strong> — where you win, where you don't</td>
          </tr>
          <tr>
            <td width="34" valign="top">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(94,211,243,.15);border:1px solid rgba(94,211,243,.4);text-align:center;line-height:24px;color:#5ed3f3;font-size:13px;font-weight:900;">✓</div>
            </td>
            <td style="color:#e6e9ec;font-size:14px;line-height:1.6;padding-left:2px;"><strong style="color:#ffffff;">12-month financial projections & breakeven</strong></td>
          </tr>
          <tr>
            <td width="34" valign="top">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(94,211,243,.15);border:1px solid rgba(94,211,243,.4);text-align:center;line-height:24px;color:#5ed3f3;font-size:13px;font-weight:900;">✓</div>
            </td>
            <td style="color:#e6e9ec;font-size:14px;line-height:1.6;padding-left:2px;"><strong style="color:#ffffff;">Execution roadmap</strong> with real KPIs</td>
          </tr>
          <tr>
            <td width="34" valign="top">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(94,211,243,.15);border:1px solid rgba(94,211,243,.4);text-align:center;line-height:24px;color:#5ed3f3;font-size:13px;font-weight:900;">✓</div>
            </td>
            <td style="color:#e6e9ec;font-size:14px;line-height:1.6;padding-left:2px;"><strong style="color:#ffffff;">All 12 sections.</strong> Zero placeholders.</td>
          </tr>
        </table>
      </div>
    </div>

    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">Your inputs are saved. Click, pay, and your complete report generates instantly — no re-entering anything.</p>
    <p style="margin:0 0 18px;color:#d0d0d0;font-size:15px;line-height:1.75;">Building more than one idea? Get <strong style="color:#5ed3f3;">5 credits for $9.95</strong> (still $1.99/report) &rarr;</p>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 4px;"><tr><td align="center" style="padding:10px 14px;border-radius:10px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);text-align:center;"><span style="color:#fbbf24;font-size:13px;line-height:1.5;font-weight:700;">Early access pricing won't last — lock in your rate now.</span></td></tr></table>
  `;

  return `
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your full report on ${idea} is ready to unlock for $1.99 — competitive analysis, financials, and roadmap included.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:34px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#1a1e24;border:1px solid rgba(94,211,243,.24);border-radius:20px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.45),0 0 0 1px rgba(94,211,243,.05);">
              <tr>
                <td style="height:4px;background:linear-gradient(90deg,#5ed3f3,#1675a9,#5ed3f3);"></td>
              </tr>
              <tr>
                <td style="padding:34px 36px 28px;background:radial-gradient(circle at 85% 0%,rgba(94,211,243,.20),transparent 55%),linear-gradient(135deg,rgba(94,211,243,.14),rgba(22,117,169,.08));text-align:center;border-bottom:1px solid rgba(255,255,255,.06);">
                  <img src="https://www.revencast.com/logo/rbg.png" alt="Revencast" style="height:52px;width:auto;border:0;" />
                  <br><div style="margin:18px 0 0;display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(94,211,243,.10);border:1px solid rgba(94,211,243,.3);color:#8fe3fb;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;">Report Locked</div>
                  <h1 style="margin:14px 0 0;font-size:27px;line-height:1.3;color:#ffffff;font-weight:800;letter-spacing:-.01em;">${firstName}, here's what your preview didn't show you</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 36px 8px;">
                  ${defaultBody}
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                    <tr>
                      <td align="center">
                        <a href="https://revencast.com/pricing?return_context=simulation_resume&utm_source=email&utm_medium=reengagement&utm_campaign=preview_upgrade" style="display:inline-block;padding:17px 32px;border-radius:14px;background:linear-gradient(135deg,#5ed3f3,#1675a9);color:#0f1215;text-decoration:none;font-weight:900;font-size:16px;box-shadow:0 12px 28px rgba(94,211,243,.28);">Unlock Full Report — $1.99 &rarr;</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:16px 0 0;color:#7f8b99;font-size:13px;line-height:1.5;text-align:center;">Your inputs are saved. Click, pay, and your complete report generates instantly — no re-entering anything.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);color:#7f8b99;font-size:12px;line-height:1.6;">
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
      // Use email from body first, then fall back to auth token (handles token propagation delay)
      const email = String(req.body?.email || auth.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Email is required' });

      const displayName = String(req.body?.display_name || '').trim().slice(0, 120);

      // Retry sending once with 2s delay for Vercel cold start + Resend readiness
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
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
          if (response.ok) {
            return res.status(200).json({ ok: true, email_id: payload?.id || '' });
          }
          lastError = { status: response.status, message: payload?.message || payload?.error || `resend_${response.status}` };
        } catch (err) {
          lastError = { status: 0, message: err?.message || 'Network error' };
        }

        // If first attempt failed, wait 2 seconds and retry
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // Both attempts failed
      return res.status(lastError?.status || 500).json({
        error: 'Welcome email failed after retry',
        details: lastError?.message || 'Unknown error'
      });
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
