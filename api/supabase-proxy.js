'use strict';

// NOTE: This function is intentionally CommonJS-compatible (no top-level `import` / `export`).
// Vercel may execute `/api/*.js` as CommonJS unless the project is configured as ESM.
// We use dynamic `import()` to load shared helpers in both ESM and CJS deployments.

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

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

const REPORT_CHAT_MAX_USER_MESSAGES = 10;
const REPORT_CHAT_MAX_CONTENT_CHARS = 12000;

async function assertReportOwned(supabaseUrl, serviceKey, uid, reportId) {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/reports?id=eq.${encodeURIComponent(
    reportId
  )}&select=id,user_id`;
  const response = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(serviceKey)
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    return { ok: false, payload };
  }
  const row = Array.isArray(payload) ? payload[0] : null;
  if (!row || String(row.user_id || '') !== String(uid || '')) {
    return { ok: false, payload: { error: 'not_found' } };
  }
  return { ok: true, row };
}

async function rpc(supabaseUrl, serviceKey, functionName, body) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: supabaseHeaders(serviceKey),
    body: JSON.stringify(body || {})
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const errorDetail = {
      status: response.status,
      statusText: response.statusText,
      message: payload?.message,
      error: payload?.error,
      details: payload?.details,
      hint: payload?.hint,
      code: payload?.code,
      rawPayload: payload
    };
    logError(`RPC ${functionName} failed:`, JSON.stringify(errorDetail, null, 2));
    throw new Error(JSON.stringify(errorDetail));
  }
  return payload;
}

async function ensureUserAccount(supabaseUrl, serviceKey, auth, body = {}) {
  const displayName = String(body?.display_name || body?.name || '').trim();
  const email = String(body?.email || '').trim();
  const companyName = String(body?.company_name || body?.company || '').trim();
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/user_accounts?on_conflict=firebase_uid`, {
    method: 'POST',
    headers: supabaseHeaders(serviceKey, 'resolution=merge-duplicates,return=representation'),
    body: JSON.stringify({
      firebase_uid: auth.uid,
      ...(email ? { email } : {}),
      ...(displayName ? { display_name: displayName } : {}),
      ...(companyName ? { company_name: companyName } : {}),
      updated_at: new Date().toISOString()
    })
  });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `supabase_account_${response.status}`);
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function updateUserAccountProfile(supabaseUrl, serviceKey, auth, body = {}) {
  const displayName = String(body?.display_name || body?.name || '').trim().replace(/\s+/g, ' ');
  const companyName = String(body?.company_name || body?.company || '').trim().replace(/\s+/g, ' ');
  const email = String(body?.email || '').trim();

  if (displayName.length < 2) {
    const err = new Error('Name must be at least 2 characters.');
    err.statusCode = 400;
    throw err;
  }
  if (displayName.length > 80) {
    const err = new Error('Name must be 80 characters or less.');
    err.statusCode = 400;
    throw err;
  }
  if (companyName.length > 120) {
    const err = new Error('Company name must be 120 characters or less.');
    err.statusCode = 400;
    throw err;
  }

  await ensureUserAccount(supabaseUrl, serviceKey, auth, {
    email,
    display_name: displayName,
    company_name: companyName
  });

  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/user_accounts?firebase_uid=eq.${encodeURIComponent(auth.uid)}&select=*`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=representation'),
      body: JSON.stringify({
        display_name: displayName,
        company_name: companyName || null,
        updated_at: new Date().toISOString()
      })
    }
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || `supabase_account_update_${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function getUserAccount(supabaseUrl, serviceKey, uid) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/user_accounts?firebase_uid=eq.${encodeURIComponent(uid)}&select=*`,
    { headers: supabaseHeaders(serviceKey) }
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `supabase_account_${response.status}`);
  }
  return Array.isArray(payload) ? payload[0] : null;
}

async function getCreditTransactions(supabaseUrl, serviceKey, uid, limit = 10) {
  const safeLimit = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/credit_transactions?firebase_uid=eq.${encodeURIComponent(uid)}&select=*&order=created_at.desc&limit=${safeLimit}`,
    { headers: supabaseHeaders(serviceKey) }
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `supabase_transactions_${response.status}`);
  }
  return Array.isArray(payload) ? payload : [];
}

async function claimFreePreview(supabaseUrl, serviceKey, auth, body = {}) {
  await ensureUserAccount(supabaseUrl, serviceKey, auth, body);
  const now = new Date().toISOString();
  const response = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/user_accounts?firebase_uid=eq.${encodeURIComponent(auth.uid)}&credits_balance=eq.0&total_credits_purchased=eq.0&total_credits_used=eq.0&free_preview_used_at=is.null&select=*`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=representation'),
      body: JSON.stringify({
        free_preview_used_at: now,
        updated_at: now
      })
    }
  );
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const message = payload?.message || payload?.error || `supabase_preview_${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  const claimed = Array.isArray(payload) ? payload[0] : payload;
  if (claimed) {
    return {
      allowed: true,
      account: claimed,
      credits_balance: Number(claimed?.credits_balance || 0),
      free_preview_used_at: claimed?.free_preview_used_at || now
    };
  }

  const account = await getUserAccount(supabaseUrl, serviceKey, auth.uid);
  return {
    allowed: false,
    account,
    credits_balance: Number(account?.credits_balance || 0),
    free_preview_used_at: account?.free_preview_used_at || null,
    reason: Number(account?.credits_balance || 0) > 0
      ? 'credits_available'
      : Number(account?.total_credits_purchased || 0) > 0 || Number(account?.total_credits_used || 0) > 0
        ? 'not_new_account'
        : 'preview_already_used'
  };
}

async function fetchSupabaseRows(supabaseUrl, serviceKey, table, params) {
  const url = new URL(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}`);
  Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), { headers: supabaseHeaders(serviceKey) });
  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `supabase_${table}_${response.status}`);
  }
  return Array.isArray(payload) ? payload : [];
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === 'nomanromane@gmail.com';
}

function dateOnlyIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function bucketByDay(rows, getDateValue) {
  const out = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const day = dateOnlyIso(getDateValue(row));
    if (!day) return;
    out.set(day, (out.get(day) || 0) + 1);
  });
  return [...out.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

function buildRecentActivity({ reports = [], credits = [], users = [] }) {
  const events = [];
  reports.forEach((r) => {
    events.push({
      type: 'report',
      title: `Report generated: ${String(r?.idea_name || 'Untitled idea')}`,
      subtitle: String(r?.target_country || ''),
      user_id: String(r?.user_id || ''),
      at: r?.created_at || null
    });
  });
  credits.forEach((t) => {
    const delta = Number(t?.credits_delta || 0);
    events.push({
      type: 'credit',
      title: `Credit ${delta >= 0 ? 'added' : 'deducted'}: ${delta}`,
      subtitle: String(t?.type || 'transaction'),
      user_id: String(t?.firebase_uid || ''),
      at: t?.created_at || null
    });
  });
  users.forEach((u) => {
    events.push({
      type: 'user',
      title: `New user: ${String(u?.display_name || u?.email || 'User')}`,
      subtitle: String(u?.email || ''),
      user_id: String(u?.firebase_uid || ''),
      at: u?.created_at || null
    });
  });
  return events
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 25);
}

function normalizeCheckoutPurchase(row) {
  if (!row) return null;
  return {
    plan_key: row.plan_key || '',
    plan_name: row.plan_name || '',
    credits: row.credits ?? null,
    amount_cents: row.amount_cents ?? null,
    currency: row.currency || 'usd',
    paid_at: row.paid_at || row.credited_at || row.created_at || null,
    stripe_session_id: row.stripe_session_id || '',
    status: row.status || '',
    payment_status: row.payment_status || ''
  };
}

function normalizeTransactionPurchase(transaction, account) {
  if (!transaction && !account?.last_plan_name) return null;
  const metadata = parseMetadata(transaction?.metadata);
  return {
    plan_key: account?.last_plan_key || metadata.plan_key || '',
    plan_name: account?.last_plan_name || metadata.plan_name || (transaction ? 'Credit purchase' : ''),
    credits: transaction?.credits_delta ?? null,
    amount_cents: metadata.amount_total ?? metadata.amount_cents ?? null,
    currency: metadata.currency || 'usd',
    paid_at: account?.last_purchase_at || transaction?.created_at || null,
    stripe_session_id: account?.last_stripe_session_id || transaction?.stripe_session_id || ''
  };
}

async function getCheckoutBySessionId(supabaseUrl, serviceKey, sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const rows = await fetchSupabaseRows(supabaseUrl, serviceKey, 'stripe_checkout_sessions', {
    stripe_session_id: `eq.${id}`,
    select: 'firebase_uid,plan_key,plan_name,credits,amount_cents,currency,paid_at,credited_at,created_at,stripe_session_id,status,payment_status',
    limit: '1'
  });
  return rows[0] || null;
}

async function getLastCheckout(supabaseUrl, serviceKey, uid) {
  const rows = await fetchSupabaseRows(supabaseUrl, serviceKey, 'stripe_checkout_sessions', {
    firebase_uid: `eq.${uid}`,
    or: '(status.eq.paid,payment_status.eq.paid,paid_at.not.is.null,credited_at.not.is.null)',
    select: 'plan_key,plan_name,credits,amount_cents,currency,paid_at,credited_at,created_at,stripe_session_id',
    order: 'paid_at.desc.nullslast,created_at.desc',
    limit: '1'
  });
  return normalizeCheckoutPurchase(rows[0]);
}

async function getLastPurchase(supabaseUrl, serviceKey, uid, account, transactions) {
  const sessionPurchase = await getCheckoutBySessionId(supabaseUrl, serviceKey, account?.last_stripe_session_id).catch(() => null);
  if (sessionPurchase?.plan_name) return normalizeCheckoutPurchase(sessionPurchase);

  const latestCheckout = await getLastCheckout(supabaseUrl, serviceKey, uid).catch(() => null);
  if (latestCheckout?.plan_name) return latestCheckout;

  const purchaseTransaction = (transactions || []).find((item) => item?.type === 'purchase') || null;
  return normalizeTransactionPurchase(purchaseTransaction, account);
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');

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
        call3_json: req.body?.call3_json ?? null,
        merged_json: req.body?.merged_json ?? null,
        pdf_report_json: req.body?.pdf_report_json ?? null, // ← ADD THIS LINE
        call1_raw: req.body?.call1_raw ?? null,
        call2_raw: req.body?.call2_raw ?? null,
        call3_raw: req.body?.call3_raw ?? null,
        forum_json: req.body?.forum_json ?? null,
        forum_raw: req.body?.forum_raw ?? null,
        references_json: req.body?.references ?? null
    };
      const insertReport = async (dataRow) => {
        const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reports`, {
          method: 'POST',
          headers: {
            ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
            Prefer: 'return=representation'
          },
          body: JSON.stringify(dataRow)
        });
        const payload = await parseJsonSafe(response);
        return { response, payload };
      };

      let { response, payload } = await insertReport(row);
      if (!response.ok) {
        const message = String(payload?.message || payload?.error || '').toLowerCase();
        const missingCall3Columns = message.includes('call3_json') || message.includes('call3_raw');
        const missingForumColumns = message.includes('forum_json') || message.includes('forum_raw');
        if (missingCall3Columns || missingForumColumns) {
          const fallbackRow = { ...row };
          if (missingCall3Columns) {
            delete fallbackRow.call3_json;
            delete fallbackRow.call3_raw;
          }
          if (missingForumColumns) {
            delete fallbackRow.forum_json;
            delete fallbackRow.forum_raw;
          }
          ({ response, payload } = await insertReport(fallbackRow));
        }
      }
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

    if (action === 'get_account') {
      const account = await ensureUserAccount(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth, req.body || {});
      const [freshAccount, credit_transactions] = await Promise.all([
        getUserAccount(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth.uid),
        getCreditTransactions(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth.uid, req.body?.limit || 8).catch(() => [])
      ]);
      const responseAccount = freshAccount || account;
      const last_purchase = await getLastPurchase(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        auth.uid,
        responseAccount,
        credit_transactions
      );
      return res.status(200).json({
        account: responseAccount,
        last_purchase,
        credit_transactions
      });
    }

    if (action === 'get_checkout_confirmation') {
      const sessionId = String(req.body?.session_id || '').trim();
      if (!sessionId) return res.status(400).json({ error: 'session_id is required' });

      const row = await getCheckoutBySessionId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionId);
      if (!row) return res.status(404).json({ error: 'Checkout session not found' });
      if (String(row.firebase_uid || '') !== String(auth.uid || '')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.status(200).json({ purchase: normalizeCheckoutPurchase(row) });
    }

    if (action === 'claim_free_preview') {
      try {
        const preview = await claimFreePreview(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth, req.body || {});
        const status = preview.allowed ? 200 : 409;
        return res.status(status).json({ preview });
      } catch (err) {
        return res.status(err?.statusCode || 500).json({
          error: err?.message || 'Unable to claim free preview'
        });
      }
    }

    if (action === 'update_account_profile') {
      try {
        const account = await updateUserAccountProfile(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth, req.body || {});
        return res.status(200).json({ account });
      } catch (err) {
        return res.status(err?.statusCode || 500).json({
          error: err?.message || 'Unable to update profile'
        });
      }
    }

    if (action === 'consume_simulation_credit') {
      await ensureUserAccount(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, auth, req.body || {});
      let result;
      try {
        result = await rpc(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'spend_report_credit', {
          p_firebase_uid: auth.uid,
          p_reason: 'simulation_run',
          p_metadata: {
            idea_name: String(req.body?.idea_name || '').trim().slice(0, 120),
            target_country: String(req.body?.target_country || '').trim().slice(0, 120)
          }
        });
      } catch (err) {
        const errMsg = String(err?.message || '');
        let errorDetails;
        try {
          errorDetails = JSON.parse(errMsg);
        } catch {
          errorDetails = { message: errMsg };
        }
        
        logError('RPC spend_report_credit error:', errorDetails);
        
        // Only allow dev mode for "function not found" errors
        const isFunctionNotFound = errMsg.includes('function') && (errMsg.includes('does not exist') || errMsg.includes('not found'));
        
        if (isFunctionNotFound) {
          logError('Credit function not set up yet, allowing simulation to proceed in dev mode');
          return res.status(200).json({
            ok: true,
            credits_balance: 0,
            transaction_id: null,
            _warning: 'Credit RPC function not deployed yet'
          });
        }
        
        // For all other errors, return the actual error so user can see what's wrong
        return res.status(503).json({
          error: 'Credit system error',
          details: errorDetails?.message || err?.message || 'Failed to process credit transaction',
          _fullError: errorDetails
        });
      }
      const outcome = Array.isArray(result) ? result[0] : result;
      if (!outcome?.ok) {
        return res.status(402).json({
          error: 'No credits available',
          credits_balance: Number(outcome?.credits_balance || 0)
        });
      }
      return res.status(200).json({
        ok: true,
        credits_balance: Number(outcome?.credits_balance || 0),
        transaction_id: outcome?.transaction_id || null
      });
    }

    if (action === 'get_report') {
      const reportId = String(req.body?.report_id || '').trim();
      if (!reportId) return res.status(400).json({ error: 'report_id is required' });

      const url = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reports?id=eq.${encodeURIComponent(
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

      const base = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reports?select=id,idea_name,target_country,created_at,status&user_id=eq.${encodeURIComponent(
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

    if (action === 'get_report_chat') {
      const reportId = String(req.body?.report_id || '').trim();
      if (!reportId) return res.status(400).json({ error: 'report_id is required' });

      const base = SUPABASE_URL.replace(/\/+$/, '');
      const own = await assertReportOwned(base, SUPABASE_SERVICE_ROLE_KEY, auth.uid, reportId);
      if (!own.ok) {
        return res.status(own.payload?.error === 'not_found' ? 404 : 500).json({
          error: 'Report not found',
          details: own.payload?.message || own.payload?.error
        });
      }

      const url = `${base}/rest/v1/report_chat_messages?report_id=eq.${encodeURIComponent(
        reportId
      )}&user_id=eq.${encodeURIComponent(auth.uid)}&order=created_at.asc&select=role,content,created_at,id`;
      const response = await fetch(url, {
        method: 'GET',
        headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY)
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        const msg = String(payload?.message || payload?.error || '').toLowerCase();
        if (msg.includes('relation') && msg.includes('does not exist')) {
          return res.status(503).json({
            error: 'Chat storage not ready',
            details: 'Create table report_chat_messages (see sql/report_chat_messages.sql).'
          });
        }
        logError('Supabase get_report_chat failed:', response.status, payload);
        return res.status(500).json({
          error: 'Failed to load report chat',
          details: payload?.message || payload?.error || `supabase_${response.status}`
        });
      }
      const messages = Array.isArray(payload) ? payload : [];
      const user_message_count = messages.filter((m) => String(m?.role) === 'user').length;
      return res.status(200).json({ messages, user_message_count });
    }

    if (action === 'save_report_chat_turn') {
      const reportId = String(req.body?.report_id || '').trim();
      const user_message = String(req.body?.user_message || '').trim();
      const assistant_message = String(req.body?.assistant_message || '').trim();
      if (!reportId) return res.status(400).json({ error: 'report_id is required' });
      if (!user_message) return res.status(400).json({ error: 'user_message is required' });
      if (!assistant_message) return res.status(400).json({ error: 'assistant_message is required' });
      if (user_message.length > REPORT_CHAT_MAX_CONTENT_CHARS) {
        return res.status(400).json({ error: 'user_message too long' });
      }
      if (assistant_message.length > REPORT_CHAT_MAX_CONTENT_CHARS) {
        return res.status(400).json({ error: 'assistant_message too long' });
      }

      const base = SUPABASE_URL.replace(/\/+$/, '');
      const own = await assertReportOwned(base, SUPABASE_SERVICE_ROLE_KEY, auth.uid, reportId);
      if (!own.ok) {
        return res.status(own.payload?.error === 'not_found' ? 404 : 500).json({
          error: 'Report not found',
          details: own.payload?.message || own.payload?.error
        });
      }

      const countUrl = `${base}/rest/v1/report_chat_messages?report_id=eq.${encodeURIComponent(
        reportId
      )}&user_id=eq.${encodeURIComponent(auth.uid)}&role=eq.user&select=id`;
      const countRes = await fetch(countUrl, {
        method: 'GET',
        headers: supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY)
      });
      const countPayload = await parseJsonSafe(countRes);
      if (!countRes.ok) {
        logError('Supabase save_report_chat_turn count failed:', countRes.status, countPayload);
        return res.status(500).json({
          error: 'Failed to verify chat limit',
          details: countPayload?.message || countPayload?.error
        });
      }
      const existingUsers = Array.isArray(countPayload) ? countPayload.length : 0;
      if (existingUsers >= REPORT_CHAT_MAX_USER_MESSAGES) {
        return res.status(403).json({ error: 'Message limit reached for this report' });
      }

      const insertUrl = `${base}/rest/v1/report_chat_messages`;
      const insertBody = [
        {
          report_id: reportId,
          user_id: auth.uid,
          role: 'user',
          content: user_message
        },
        {
          report_id: reportId,
          user_id: auth.uid,
          role: 'assistant',
          content: assistant_message
        }
      ];
      const insertRes = await fetch(insertUrl, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(insertBody)
      });
      const insertPayload = await parseJsonSafe(insertRes);
      if (!insertRes.ok) {
        const msg = String(insertPayload?.message || insertPayload?.error || '').toLowerCase();
        if (msg.includes('relation') && msg.includes('does not exist')) {
          return res.status(503).json({
            error: 'Chat storage not ready',
            details: 'Create table report_chat_messages (see sql/report_chat_messages.sql).'
          });
        }
        logError('Supabase save_report_chat_turn insert failed:', insertRes.status, insertPayload);
        return res.status(500).json({
          error: 'Failed to save chat',
          details: insertPayload?.message || insertPayload?.error || `supabase_${insertRes.status}`
        });
      }

      const user_message_count = existingUsers + 1;
      return res.status(200).json({ ok: true, user_message_count });
    }

    if (String(action || '').startsWith('admin_')) {
      if (!isAdminEmail(auth?.email)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (action === 'admin_overview') {
        const [users, reports, credits, webhooks] = await Promise.all([
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
            select: 'firebase_uid,email,display_name,created_at,updated_at,credits_balance',
            order: 'created_at.desc',
            limit: '5000'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
            select: 'id,user_id,idea_name,target_country,status,error,created_at',
            order: 'created_at.desc',
            limit: '5000'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'credit_transactions', {
            select: 'id,firebase_uid,type,credits_delta,created_at,metadata',
            order: 'created_at.desc',
            limit: '5000'
          }).catch(() => []),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'stripe_checkout_sessions', {
            select: 'id,amount_cents,credits,currency,paid_at,created_at,status,payment_status,firebase_uid',
            order: 'created_at.desc',
            limit: '2000'
          }).catch(() => [])
        ]);

        const now = Date.now();
        const dayAgo = now - (24 * 60 * 60 * 1000);
        const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
        const activeDaily = users.filter((u) => new Date(u?.updated_at || u?.last_sign_in_at || 0).getTime() >= dayAgo).length;
        const activeMonthly = users.filter((u) => new Date(u?.updated_at || u?.last_sign_in_at || 0).getTime() >= monthAgo).length;
        const totalRevenueCents = webhooks
          .filter((w) => String(w?.status || '').toLowerCase() === 'paid' || String(w?.payment_status || '').toLowerCase() === 'paid' || Boolean(w?.paid_at))
          .reduce((sum, w) => sum + Number(w?.amount_cents || 0), 0);
        const creditsUsed = credits
          .filter((t) => Number(t?.credits_delta || 0) < 0)
          .reduce((sum, t) => sum + Math.abs(Number(t?.credits_delta || 0)), 0);
        const trendReports = bucketByDay(reports, (r) => r?.created_at);
        const trendUsers = bucketByDay(users, (u) => u?.created_at);
        const recentActivity = buildRecentActivity({
          reports: reports.slice(0, 30),
          credits: credits.slice(0, 30),
          users: users.slice(0, 30)
        });

        return res.status(200).json({
          metrics: {
            total_users: users.length,
            active_daily: activeDaily,
            active_monthly: activeMonthly,
            total_reports: reports.length,
            total_revenue_cents: totalRevenueCents,
            credits_used: creditsUsed
          },
          trends: {
            reports_by_day: trendReports,
            users_by_day: trendUsers
          },
          recent_activity: recentActivity
        });
      }

      if (action === 'admin_list_users') {
        const q = String(req.body?.query || '').trim().toLowerCase();
        const limitRaw = Number(req.body?.limit ?? 25);
        const offsetRaw = Number(req.body?.offset ?? 0);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 25;
        const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
        const rows = await fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
          select: 'firebase_uid,email,display_name,company_name,created_at,updated_at,credits_balance,total_credits_purchased,total_credits_used',
          order: 'created_at.desc',
          limit: '5000'
        });
        const filtered = q
          ? rows.filter((u) => [u?.email, u?.display_name, u?.company_name, u?.firebase_uid].some((v) => String(v || '').toLowerCase().includes(q)))
          : rows;
        const paged = filtered.slice(offset, offset + limit);
        return res.status(200).json({
          users: paged,
          total: filtered.length,
          limit,
          offset
        });
      }

      if (action === 'admin_get_user_detail') {
        const uid = String(req.body?.uid || '').trim();
        if (!uid) return res.status(400).json({ error: 'uid is required' });
        const [users, reports, credits] = await Promise.all([
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
            firebase_uid: `eq.${uid}`,
            select: '*',
            limit: '1'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
            user_id: `eq.${uid}`,
            select: 'id,idea_name,target_country,status,error,created_at',
            order: 'created_at.desc',
            limit: '100'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'credit_transactions', {
            firebase_uid: `eq.${uid}`,
            select: '*',
            order: 'created_at.desc',
            limit: '100'
          }).catch(() => [])
        ]);
        const user = users[0] || null;
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.status(200).json({ user, reports, credit_transactions: credits });
      }

      if (action === 'admin_update_user_credits') {
        const uid = String(req.body?.uid || '').trim();
        const delta = Number(req.body?.delta || 0);
        const reason = String(req.body?.reason || 'admin_adjustment').trim().slice(0, 200);
        if (!uid) return res.status(400).json({ error: 'uid is required' });
        if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'delta must be a non-zero number' });

        const users = await fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
          firebase_uid: `eq.${uid}`,
          select: '*',
          limit: '1'
        });
        const user = users[0];
        if (!user) return res.status(404).json({ error: 'User not found' });
        const nextBalance = Math.max(0, Number(user?.credits_balance || 0) + delta);

        const updateResp = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/user_accounts?firebase_uid=eq.${encodeURIComponent(uid)}&select=*`, {
          method: 'PATCH',
          headers: {
            ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=representation')
          },
          body: JSON.stringify({
            credits_balance: nextBalance,
            updated_at: new Date().toISOString()
          })
        });
        const updatePayload = await parseJsonSafe(updateResp);
        if (!updateResp.ok) {
          return res.status(500).json({ error: updatePayload?.message || updatePayload?.error || 'Failed to update credits' });
        }

        await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/credit_transactions`, {
          method: 'POST',
          headers: {
            ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY)
          },
          body: JSON.stringify({
            firebase_uid: uid,
            type: 'admin_adjustment',
            credits_delta: delta,
            metadata: {
              reason,
              admin_email: auth?.email || '',
              previous_balance: Number(user?.credits_balance || 0),
              next_balance: nextBalance
            }
          })
        }).catch(() => null);

        return res.status(200).json({
          ok: true,
          user: Array.isArray(updatePayload) ? updatePayload[0] : updatePayload
        });
      }

      if (action === 'admin_list_reports') {
        const q = String(req.body?.query || '').trim().toLowerCase();
        const statusFilter = String(req.body?.status || '').trim().toLowerCase();
        const from = String(req.body?.from || '').trim();
        const to = String(req.body?.to || '').trim();
        const limitRaw = Number(req.body?.limit ?? 50);
        const offsetRaw = Number(req.body?.offset ?? 0);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
        const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

        const [reports, users] = await Promise.all([
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
            select: 'id,user_id,idea_name,target_country,status,error,created_at,input,merged_json',
            order: 'created_at.desc',
            limit: '5000'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
            select: 'firebase_uid,email,display_name',
            limit: '5000'
          })
        ]);
        const userById = new Map(users.map((u) => [String(u?.firebase_uid || ''), u]));
        let rows = reports.map((r) => ({
          ...r,
          user_email: userById.get(String(r?.user_id || ''))?.email || '',
          user_name: userById.get(String(r?.user_id || ''))?.display_name || ''
        }));
        if (q) {
          rows = rows.filter((r) =>
            [r?.idea_name, r?.target_country, r?.user_email, r?.user_name, r?.status].some((v) =>
              String(v || '').toLowerCase().includes(q)
            )
          );
        }
        if (statusFilter) rows = rows.filter((r) => String(r?.status || '').toLowerCase() === statusFilter);
        if (from) rows = rows.filter((r) => new Date(r?.created_at || 0).getTime() >= new Date(from).getTime());
        if (to) rows = rows.filter((r) => new Date(r?.created_at || 0).getTime() <= new Date(to).getTime());
        const paged = rows.slice(offset, offset + limit);
        return res.status(200).json({ reports: paged, total: rows.length, limit, offset });
      }

      if (action === 'admin_get_report_detail') {
        const reportId = String(req.body?.report_id || '').trim();
        if (!reportId) return res.status(400).json({ error: 'report_id is required' });
        const rows = await fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
          id: `eq.${reportId}`,
          select: '*',
          limit: '1'
        });
        const report = rows[0] || null;
        if (!report) return res.status(404).json({ error: 'Report not found' });
        return res.status(200).json({ report });
      }

      if (action === 'admin_analytics') {
        const [reports, users] = await Promise.all([
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
            select: 'id,user_id,created_at,status',
            order: 'created_at.desc',
            limit: '5000'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'user_accounts', {
            select: 'firebase_uid,created_at',
            order: 'created_at.desc',
            limit: '5000'
          })
        ]);
        const reportsByDay = bucketByDay(reports, (r) => r?.created_at);
        const usersByDay = bucketByDay(users, (u) => u?.created_at);
        const weeklyVisits = reportsByDay.slice(-7).reduce((sum, d) => sum + Number(d.value || 0), 0);
        const monthlyVisits = reportsByDay.slice(-30).reduce((sum, d) => sum + Number(d.value || 0), 0);
        const dailyVisits = reportsByDay.length ? Number(reportsByDay[reportsByDay.length - 1].value || 0) : 0;
        return res.status(200).json({
          summary: {
            daily_visits: dailyVisits,
            weekly_visits: weeklyVisits,
            monthly_visits: monthlyVisits,
            page_views: reports.length,
            avg_session_duration_sec: null
          },
          charts: {
            usage_by_day: reportsByDay,
            users_by_day: usersByDay
          },
          breakdown: {
            devices: [],
            browsers: []
          }
        });
      }

      if (action === 'admin_list_errors') {
        const [reports, webhooks] = await Promise.all([
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'reports', {
            select: 'id,user_id,error,status,created_at',
            order: 'created_at.desc',
            limit: '1000'
          }),
          fetchSupabaseRows(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'stripe_webhook_events', {
            select: 'id,error,event_type,created_at,status',
            order: 'created_at.desc',
            limit: '1000'
          }).catch(() => [])
        ]);
        const reportErrors = reports
          .filter((r) => String(r?.error || '').trim())
          .map((r) => ({
            source: 'report',
            id: String(r?.id || ''),
            message: String(r?.error || ''),
            severity: String(r?.status || '').toLowerCase() === 'failed' ? 'critical' : 'warning',
            user_id: String(r?.user_id || ''),
            route: '/simulation',
            created_at: r?.created_at || null,
            resolved: false
          }));
        const webhookErrors = webhooks
          .filter((w) => String(w?.error || '').trim())
          .map((w) => ({
            source: 'webhook',
            id: String(w?.id || ''),
            message: String(w?.error || ''),
            severity: 'warning',
            user_id: '',
            route: '/api/stripe-webhook',
            created_at: w?.created_at || null,
            resolved: false
          }));
        const errors = [...reportErrors, ...webhookErrors]
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        return res.status(200).json({ errors });
      }

      if (action === 'admin_resolve_error') {
        const source = String(req.body?.source || '').trim();
        const id = String(req.body?.id || '').trim();
        if (!source || !id) return res.status(400).json({ error: 'source and id are required' });

        if (source === 'report') {
          const resp = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/reports?id=eq.${encodeURIComponent(id)}&select=id,error,status`, {
            method: 'PATCH',
            headers: {
              ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY, 'return=representation')
            },
            body: JSON.stringify({
              error: null,
              updated_at: new Date().toISOString()
            })
          });
          const payload = await parseJsonSafe(resp);
          if (!resp.ok) return res.status(500).json({ error: payload?.message || payload?.error || 'Failed to resolve report error' });
          return res.status(200).json({ ok: true, row: Array.isArray(payload) ? payload[0] : payload });
        }

        return res.status(400).json({ error: 'Unsupported error source' });
      }
    }

    return res.status(400).json({ error: `Unknown action: ${String(action).slice(0, 80)}` });
  } catch (err) {
    // Ensure CORS headers are present even in unexpected error paths.
    setCors(res, 'GET, POST, OPTIONS');
    logError('Supabase proxy error:', err);
    return res.status(500).json({ error: 'Supabase proxy error', details: err?.message || 'Unknown error' });
  }
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };
