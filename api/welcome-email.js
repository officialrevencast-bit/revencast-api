'use strict';

const crypto = require('crypto');

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

function getOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').trim();
  return host ? `${proto}://${host}` : 'https://www.revencast.com';
}

function buildTrackingId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
}

function buildTrackedUrls(req, trackingId) {
  const origin = getOrigin(req).replace(/\/+$/, '');
  const destination = new URL('/pricing', origin);
  destination.searchParams.set('return_context', 'simulation_resume');
  destination.searchParams.set('utm_source', 'email');
  destination.searchParams.set('utm_medium', 'reengagement');
  destination.searchParams.set('utm_campaign', 'preview_upgrade');
  destination.searchParams.set('email_tracking_id', trackingId);

  const click = new URL('/api/welcome-email', origin);
  click.searchParams.set('e', 'click');
  click.searchParams.set('t', trackingId);
  click.searchParams.set('u', destination.toString());

  const open = new URL('/api/welcome-email', origin);
  open.searchParams.set('e', 'open');
  open.searchParams.set('t', trackingId);

  return { clickUrl: click.toString(), openPixelUrl: open.toString(), destinationUrl: destination.toString() };
}

async function insertTrackingSend(row) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reengagement_email_sends`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=minimal'),
      body: JSON.stringify(row)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function updateTrackingSend(trackingId, updates) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !trackingId) return;
  try {
    await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reengagement_email_sends?tracking_id=eq.${encodeURIComponent(trackingId)}`, {
      method: 'PATCH',
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=minimal'),
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
    });
  } catch {}
}

async function insertTrackingEvent(row) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reengagement_email_events`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=minimal'),
      body: JSON.stringify(row)
    });
  } catch {}
}

function parseTrackingId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function safeTargetUrl(raw) {
  const fallback = 'https://www.revencast.com/pricing?return_context=simulation_resume&utm_source=email&utm_medium=reengagement&utm_campaign=preview_upgrade';
  const value = String(raw || '').trim();
  if (!value) return fallback;
  try {
    const url = new URL(value, 'https://www.revencast.com');
    const host = url.hostname.toLowerCase();
    if (host === 'revencast.com' || host === 'www.revencast.com') return url.toString();
  } catch {}
  return fallback;
}

async function getTrackingSendRow(trackingId) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !trackingId) return null;
  try {
    const response = await fetch(
      `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reengagement_email_sends?tracking_id=eq.${encodeURIComponent(trackingId)}&select=tracking_id,firebase_uid,email&limit=1`,
      { headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY) }
    );
    const payload = await parseJsonSafe(response);
    if (!response.ok) return null;
    return Array.isArray(payload) ? payload[0] : null;
  } catch {
    return null;
  }
}

function transparentGif() {
  return Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
}

async function handleTrackingRequest(req, res) {
  const trackingId = parseTrackingId(req.query?.t);
  const eventType = String(req.query?.e || '').trim().toLowerCase() === 'click' ? 'click' : 'open';
  const targetUrl = safeTargetUrl(req.query?.u);

  if (trackingId) {
    try {
      const send = await getTrackingSendRow(trackingId);
      if (send) {
        await insertTrackingEvent({
          tracking_id: trackingId,
          event_type: eventType,
          firebase_uid: send.firebase_uid || null,
          email: send.email || null,
          target_url: eventType === 'click' ? targetUrl : null,
          user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
          ip_address: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 120),
          referrer: String(req.headers.referer || req.headers.referrer || '').slice(0, 500)
        });
      }
    } catch {
      // Tracking must never block an email open pixel or click redirect.
    }
  }

  if (eventType === 'click') {
    res.statusCode = 302;
    res.setHeader('Location', targetUrl);
    return res.end();
  }

  const gif = transparentGif();
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Content-Length', String(gif.length));
  return res.status(200).end(gif);
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

function parseReEngageTemplateKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key === 'full_report' ? 'full_report' : 'saved_preview';
}

function buildSavedPreviewReEngageEmailHtml({ name, email, ideaName, ideaDescription, targetCountry, customBody, ctaUrl, openPixelUrl }) {
  const firstName = escapeHtml(getFirstName(name, email));
  const idea = escapeHtml(String(ideaName || 'your idea').trim());
  const description = escapeHtml(String(ideaDescription || '').trim());
  const country = escapeHtml(String(targetCountry || '').trim());
  const marketLine = country ? ` for ${country}` : '';
  const bodyContent = String(customBody || '').trim();

  const defaultBody = bodyContent || `
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">You started a Revencast preview for <strong style="color:#ffffff;">${idea}</strong>${marketLine}. The preview is still saved, so you can continue without entering the idea again.</p>
    <p style="margin:0 0 20px;color:#d0d0d0;font-size:15px;line-height:1.75;">Continuing the simulation will use the same idea and market inputs you already provided. The next step adds deeper sections for competitors, financials, risks, and execution planning.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border:1px solid rgba(94,211,243,.16);border-radius:12px;background:rgba(255,255,255,.035);">
      <tr>
        <td style="padding:17px 18px;color:#d9dee4;font-size:14px;line-height:1.65;">
          <strong style="display:block;margin:0 0 6px;color:#ffffff;font-size:15px;">Your saved preview</strong>
          Idea: ${idea}<br />
          ${country ? `Market: ${country}<br />` : ''}
          ${description ? `Notes: ${description}<br />` : ''}
          Status: ready to continue
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">If you are still considering this idea, this is the quickest way to pick up where you left off.</p>
  `;

  return `
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your saved Revencast preview for ${idea} is ready to continue.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:30px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#1a1e24;border:1px solid rgba(94,211,243,.18);border-radius:16px;overflow:hidden;box-shadow:0 14px 36px rgba(0,0,0,.32);">
              <tr>
                <td style="height:3px;background:#5ed3f3;"></td>
              </tr>
              <tr>
                <td style="padding:30px 36px 26px;background:rgba(94,211,243,.07);border-bottom:1px solid rgba(255,255,255,.06);">
                  <img src="https://www.revencast.com/logo/rbg.png" alt="Revencast" style="height:50px;width:auto;border:0;display:block;" />
                  <h1 style="margin:20px 0 0;font-size:25px;line-height:1.32;color:#ffffff;font-weight:800;">${firstName}, your preview is still saved</h1>
                  <p style="margin:10px 0 0;color:#b8c0c9;font-size:15px;line-height:1.65;">You can continue the simulation whenever you are ready.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 36px 8px;">
                  ${defaultBody}
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                    <tr>
                      <td align="center">
                        <a href="${escapeHtml(ctaUrl || 'https://www.revencast.com/pricing?return_context=simulation_resume&utm_source=email&utm_medium=reengagement&utm_campaign=preview_upgrade')}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#5ed3f3;color:#0f1215;text-decoration:none;font-weight:800;font-size:15px;">Continue saved preview</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:16px 0 0;color:#7f8b99;font-size:13px;line-height:1.5;text-align:center;">This opens the saved preview flow using your existing inputs.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);color:#7f8b99;font-size:12px;line-height:1.6;">
                  Questions? <a href="mailto:support@revencast.com" style="color:#5ed3f3;text-decoration:none;">support@revencast.com</a><br />
                  You are getting this because you ran a free preview for "${idea}".
                </td>
              </tr>
            </table>
            ${openPixelUrl ? `<img src="${escapeHtml(openPixelUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;opacity:0;overflow:hidden;" />` : ''}
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildFullReportReEngageEmailHtml({ name, email, ideaName, ideaDescription, targetCountry, customBody, ctaUrl, openPixelUrl }) {
  const firstName = escapeHtml(getFirstName(name, email));
  const idea = escapeHtml(String(ideaName || 'your idea').trim());
  const description = escapeHtml(String(ideaDescription || '').trim());
  const country = escapeHtml(String(targetCountry || '').trim());
  const bodyContent = String(customBody || '').trim();

  const defaultBody = bodyContent || `
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">You already ran a preview for <strong style="color:#5ed3f3;">${idea}</strong>${country ? ` in ${country}` : ''}. The saved preview gave you the first signals; the complete simulation adds the deeper business view.</p>
    <p style="margin:0 0 22px;color:#d0d0d0;font-size:15px;line-height:1.75;">If you are still deciding whether this idea is worth pursuing, the next step gives you the sections that are most useful for comparison, planning, and execution.</p>
    <div style="margin:0 0 22px;padding:2px;border-radius:16px;background:linear-gradient(135deg,rgba(94,211,243,.35),rgba(22,117,169,.15));">
      <div style="padding:20px;border-radius:14px;background:#171b20;">
        <div style="margin:0 0 14px;color:#8fe3fb;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;">Complete simulation includes</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
          <tr><td width="28" valign="top" style="color:#5ed3f3;font-weight:900;">1.</td><td style="color:#e6e9ec;font-size:14px;line-height:1.6;"><strong style="color:#ffffff;">Competitor context</strong> with positioning and pricing comparison</td></tr>
          <tr><td width="28" valign="top" style="color:#5ed3f3;font-weight:900;">2.</td><td style="color:#e6e9ec;font-size:14px;line-height:1.6;"><strong style="color:#ffffff;">Financial estimates</strong> including revenue, costs, and breakeven signals</td></tr>
          <tr><td width="28" valign="top" style="color:#5ed3f3;font-weight:900;">3.</td><td style="color:#e6e9ec;font-size:14px;line-height:1.6;"><strong style="color:#ffffff;">Execution roadmap</strong> with milestones, KPIs, and risk notes</td></tr>
        </table>
      </div>
    </div>
    <p style="margin:0 0 16px;color:#d0d0d0;font-size:15px;line-height:1.75;">Your inputs are saved. Click, pay, and your complete report generates instantly - no re-entering anything.</p>
    <p style="margin:0 0 18px;color:#d0d0d0;font-size:15px;line-height:1.75;">Building more than one idea? Get <strong style="color:#5ed3f3;">5 credits for $9.95</strong> and keep validating without starting from scratch.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 4px;"><tr><td align="center" style="padding:10px 14px;border-radius:10px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);text-align:center;"><span style="color:#fbbf24;font-size:13px;line-height:1.5;font-weight:700;">Early access pricing will not last - lock in your rate now.</span></td></tr></table>
  `;

  return `
    <div style="margin:0;padding:0;background:#0f1215;color:#f0f0f0;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Revencast preview for ${idea} can be completed from the saved simulation.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f1215;padding:34px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#1a1e24;border:1px solid rgba(94,211,243,.24);border-radius:20px;overflow:hidden;box-shadow:0 18px 46px rgba(0,0,0,.40);">
              <tr><td style="height:4px;background:linear-gradient(90deg,#5ed3f3,#1675a9,#5ed3f3);"></td></tr>
              <tr>
                <td style="padding:34px 36px 28px;background:linear-gradient(135deg,rgba(94,211,243,.14),rgba(22,117,169,.08));text-align:center;border-bottom:1px solid rgba(255,255,255,.06);">
                  <img src="https://www.revencast.com/logo/rbg.png" alt="Revencast" style="height:50px;width:auto;border:0;" />
                  <h1 style="margin:18px 0 0;font-size:27px;line-height:1.3;color:#ffffff;font-weight:800;">${firstName}, continue the simulation for ${idea}</h1>
                  <p style="margin:10px auto 0;color:#b8c0c9;font-size:15px;line-height:1.65;max-width:480px;">Your preview is saved. Complete it when you are ready to review the deeper analysis.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:30px 36px 8px;">
                  ${defaultBody}
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                    <tr>
                      <td align="center">
                        <a href="${escapeHtml(ctaUrl || 'https://www.revencast.com/pricing?return_context=simulation_resume&utm_source=email&utm_medium=reengagement&utm_campaign=preview_upgrade')}" style="display:inline-block;padding:16px 28px;border-radius:12px;background:linear-gradient(135deg,#5ed3f3,#1675a9);color:#0f1215;text-decoration:none;font-weight:900;font-size:15px;">Unlock Full Report - $1.99</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:16px 0 0;color:#7f8b99;font-size:13px;line-height:1.5;text-align:center;">This opens the saved preview flow using your existing inputs.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);color:#7f8b99;font-size:12px;line-height:1.6;">
                  Questions? <a href="mailto:support@revencast.com" style="color:#5ed3f3;text-decoration:none;">support@revencast.com</a><br />
                  You are getting this because you ran a free preview for "${idea}".
                </td>
              </tr>
            </table>
            ${openPixelUrl ? `<img src="${escapeHtml(openPixelUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;opacity:0;overflow:hidden;" />` : ''}
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildReEngageEmailHtml(options) {
  return parseReEngageTemplateKey(options?.templateKey) === 'full_report'
    ? buildFullReportReEngageEmailHtml(options)
    : buildSavedPreviewReEngageEmailHtml(options);
}

function buildReEngageEmailText({ name, email, ideaName, targetCountry, destinationUrl, templateKey }) {
  const greeting = `${name ? getFirstName(name, email) : 'Hi'},`;
  const idea = ideaName || 'your idea';
  if (parseReEngageTemplateKey(templateKey) === 'full_report') {
    return [
      greeting,
      '',
      `You recently ran a free preview simulation for "${idea}"${targetCountry ? ` targeting the ${targetCountry} market.` : '.'}`,
      '',
      'Your preview is saved, so you can continue from the same idea and market inputs.',
      '',
      'Unlock your complete market validation report starting at $1.99 for a single credit.',
      '',
      'The complete simulation adds competitor context, financial estimates, risk notes, and execution planning.',
      '',
      `Unlock full report: ${destinationUrl}`,
      '',
      'Revencast Team'
    ].join('\n');
  }
  return [
    greeting,
    '',
    `You recently ran a free preview simulation for "${idea}"${targetCountry ? ` targeting the ${targetCountry} market.` : '.'}`,
    '',
    'Your preview is still saved, so you can continue without entering the idea again.',
    '',
    'Continuing the simulation will use the same idea and market inputs you already provided.',
    '',
    'The next step adds:',
    '- competitor context',
    '- financial estimates',
    '- risk notes',
    '- execution planning',
    '',
    `Continue here: ${destinationUrl}`,
    '',
    'Your preview data is safely saved.',
    '',
    'Revencast Team'
  ].join('\n');
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');
  setCors(res, 'GET, POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method === 'GET') return handleTrackingRequest(req, res);
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
    // DISABLED: welcome emails are now sent exclusively from the supabase-proxy handler
    // (ensureUserAccount → sendWelcomeEmail). This path is intentionally a no-op to avoid
    // duplicate sends. Returns 200 so any caller expecting a success response isn't broken.
    if (action === 'welcome') {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Welcome email sending disabled on this endpoint' });
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
      const templateKey = parseReEngageTemplateKey(req.body?.template_key);

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
        const trackingId = buildTrackingId();
        const { clickUrl, openPixelUrl, destinationUrl } = buildTrackedUrls(req, trackingId);
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
          await insertTrackingSend({
            tracking_id: trackingId,
            firebase_uid: String(recipient.firebase_uid || '').trim() || null,
            email,
            display_name: name || null,
            idea_name: ideaName || null,
            target_country: targetCountry || null,
            preview_report_id: String(recipient.preview_report_id || recipient.latest_preview_id || '').trim() || null,
            subject,
            status: 'pending'
          });

          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${RESEND_API_KEY}`,
              'User-Agent': 'Revencast/1.0'
            },
            body: JSON.stringify({
              from: 'Revencast Team <hello@revencast.com>',
              to: email,
              subject: subject,
              html: buildReEngageEmailHtml({
                name,
                email,
                ideaName,
                ideaDescription,
                targetCountry,
                customBody: custom_body || '',
                ctaUrl: clickUrl,
                openPixelUrl,
                templateKey
              }),
              text: buildReEngageEmailText({
                name,
                email,
                ideaName,
                targetCountry,
                destinationUrl,
                templateKey
              })
            })
          });

          const payload = await parseJsonSafe(response);
          if (response.ok) {
            const sentAt = new Date().toISOString();
            await updateTrackingSend(trackingId, {
              status: 'sent',
              provider_email_id: payload?.id || null,
              sent_at: sentAt
            });
            await insertTrackingEvent({
              tracking_id: trackingId,
              event_type: 'sent',
              firebase_uid: String(recipient.firebase_uid || '').trim() || null,
              email
            });
            results.push({ email, status: 'sent', email_id: payload?.id || '', tracking_id: trackingId });
          } else {
            await updateTrackingSend(trackingId, {
              status: 'failed',
              error: payload?.message || payload?.error || `resend_${response.status}`
            });
            errors.push({
              email,
              error: payload?.message || payload?.error || `resend_${response.status}`
            });
          }
        } catch (err) {
          await updateTrackingSend(trackingId, {
            status: 'failed',
            error: err?.message || 'Network error'
          });
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
    setCors(res, 'GET, POST, OPTIONS');
    return res.status(500).json({ error: 'Email request failed', details: err?.message || 'Unknown error' });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
