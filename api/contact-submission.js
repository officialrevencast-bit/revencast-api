'use strict';

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

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

async function handler(req, res) {
  const { setCors } = await import('./_auth-utils.js');
  setCors(res, 'POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: 'Supabase not configured',
        details: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      });
    }

    const fullName = cleanText(req.body?.full_name || req.body?.fullName, 120);
    const email = cleanText(req.body?.email, 160).toLowerCase();
    const company = cleanText(req.body?.company, 140);
    const message = String(req.body?.message || '').trim().slice(0, 5000);
    const pageUrl = String(req.body?.page_url || '').trim().slice(0, 500);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (fullName.length < 2) return res.status(400).json({ error: 'Full name is required' });
    if (!emailPattern.test(email)) return res.status(400).json({ error: 'A valid email address is required' });
    if (message.length < 10) return res.status(400).json({ error: 'Message must be at least 10 characters' });

    const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/contact_submissions`, {
      method: 'POST',
      headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=representation'),
      body: JSON.stringify({
        full_name: fullName,
        email,
        company: company || null,
        message,
        page_url: pageUrl || null,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        status: 'new'
      })
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      return res.status(500).json({
        error: 'Failed to save contact submission',
        details: payload?.message || payload?.error || `supabase_${response.status}`
      });
    }

    const submission = Array.isArray(payload) ? payload[0] : payload;
    return res.status(200).json({ ok: true, submission_id: submission?.id || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Contact submission failed', details: err?.message || 'Unknown error' });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
