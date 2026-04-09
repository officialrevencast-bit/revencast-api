import { authorizeRequest, setCors } from './_auth-utils.js';

export const config = { runtime: 'nodejs' };

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json'
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

export default async function handler(req, res) {
  // Always set CORS headers early. If the function crashes before a response is sent,
  // the platform may return a default 500 without these headers (causing CORS failures).
  setCors(res, 'GET, POST, OPTIONS');

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Lightweight health check (no auth). Useful for confirming the function is deployed and not crashing.
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        service: 'supabase-proxy',
        ts: new Date().toISOString()
      });
    }

    const auth = await authorizeRequest(req, res);
    if (!auth || !auth.ok) return;

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const SUPABASE_URL = getEnv('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: 'Supabase not configured',
        details: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      });
    }

    const { action } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    if (action === 'create_report') {
      const idea_name = String(req.body?.idea_name || '').trim();
      const product_idea = String(req.body?.product_idea || '').trim();
      const target_country = String(req.body?.target_country || '').trim();
      const status = String(req.body?.status || 'complete').trim() || 'complete';

      if (!idea_name) return res.status(400).json({ error: 'idea_name is required' });
      if (!product_idea) return res.status(400).json({ error: 'product_idea is required' });
      if (!target_country) return res.status(400).json({ error: 'target_country is required' });

      const row = {
        user_id: auth.uid,
        idea_name,
        target_country,
        status,
        error: req.body?.error ? String(req.body.error) : null,
        input: {
          idea_name,
          product_idea,
          target_country
        },
        call1_json: req.body?.call1_json ?? null,
        call2_json: req.body?.call2_json ?? null,
        merged_json: req.body?.merged_json ?? null,
        call1_raw: req.body?.call1_raw ?? null,
        call2_raw: req.body?.call2_raw ?? null,
        references: req.body?.references ?? null
      };

      const response = await fetch(`${SUPABASE_URL.replace(/\\/+$/, '')}/rest/v1/reports`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
          Prefer: 'return=representation'
        },
        body: JSON.stringify(row)
      });

      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        logError('Supabase create_report failed:', response.status, payload);
        return res.status(500).json({
          error: 'Failed to create report',
          details: payload?.message || payload?.error || `supabase_${response.status}`
        });
      }

      const created = Array.isArray(payload) ? payload[0] : payload;
      const report_id = created?.id || '';
      if (!report_id) {
        return res.status(500).json({ error: 'Report created but id missing' });
      }
      return res.status(200).json({ report_id });
    }

    if (action === 'get_report') {
      const reportId = String(req.body?.report_id || '').trim();
      if (!reportId) return res.status(400).json({ error: 'report_id is required' });

      const url = `${SUPABASE_URL.replace(/\\/+$/, '')}/rest/v1/reports?id=eq.${encodeURIComponent(
        reportId
      )}&select=*`;

      const response = await fetch(url, {
        method: 'GET',
        headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY)
      });

      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        logError('Supabase get_report failed:', response.status, payload);
        return res.status(500).json({
          error: 'Failed to fetch report',
          details: payload?.message || payload?.error || `supabase_${response.status}`
        });
      }

      const report = Array.isArray(payload) ? payload[0] : null;
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (String(report.user_id || '') !== String(auth.uid || '')) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      return res.status(200).json({ report });
    }

    if (action === 'list_reports') {
      const limitRaw = Number(req.body?.limit ?? 20);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;
      const cursor = String(req.body?.cursor || '').trim(); // cursor is ISO date string for created_at

      const base = `${SUPABASE_URL.replace(/\\/+$/, '')}/rest/v1/reports?select=id,idea_name,target_country,created_at,status&user_id=eq.${encodeURIComponent(
        auth.uid
      )}&order=created_at.desc&limit=${limit}`;
      const withCursor = cursor ? `${base}&created_at=lt.${encodeURIComponent(cursor)}` : base;

      const response = await fetch(withCursor, {
        method: 'GET',
        headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY)
      });

      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        logError('Supabase list_reports failed:', response.status, payload);
        return res.status(500).json({
          error: 'Failed to list reports',
          details: payload?.message || payload?.error || `supabase_${response.status}`
        });
      }

      const docs = Array.isArray(payload) ? payload : [];
      const next_cursor = docs.length ? String(docs[docs.length - 1]?.created_at || '') : '';
      return res.status(200).json({ reports: docs, next_cursor });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    // Ensure CORS headers are present even in unexpected error paths.
    setCors(res, 'GET, POST, OPTIONS');
    logError('Supabase proxy error:', err);
    return res.status(500).json({ error: 'Supabase proxy error', details: err?.message || 'Unknown error' });
  }
}
