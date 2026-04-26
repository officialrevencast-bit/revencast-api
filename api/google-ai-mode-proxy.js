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

function isMetadataOnlyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (!keys.length) return false;
  const allowed = new Set(['search_metadata', 'search_parameters']);
  return keys.every((k) => allowed.has(k));
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');

  setCors(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  const apiKeys = [process.env.SERPAPI_KEY, process.env.SERPAPI_KEY_2, process.env.SERPAPI_KEY_3].filter(Boolean);
  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const incoming =
    req.method === 'POST'
      ? new URLSearchParams(
          Object.entries(req.body || {}).flatMap(([k, v]) => (v == null ? [] : [[k, String(v)]]))
        )
      : new URLSearchParams(req.query);

  const engine = incoming.get('engine');
  if (engine && engine !== 'google_ai_mode') {
    return res.status(400).json({ error: 'Invalid engine. Use engine=google_ai_mode.' });
  }
  incoming.set('engine', 'google_ai_mode');

  const q = incoming.get('q');
  if (!q) {
    return res.status(400).json({ error: 'Missing required parameter: q' });
  }

  let lastError = null;

  const getSerpErrorMessage = (payload) => {
    if (!payload || typeof payload !== 'object') return '';
    return (
      payload.error ||
      payload.message ||
      payload?.search_metadata?.error ||
      payload?.search_metadata?.status ||
      payload?.error_message ||
      ''
    );
  };

  const shouldFailover = (status, payload) => {
    const msg = String(getSerpErrorMessage(payload) || '').toLowerCase();
    const keyOrQuotaIssue =
      msg.includes('invalid api key') ||
      msg.includes('api key not found') ||
      msg.includes('unauthorized') ||
      msg.includes('run out of searches') ||
      msg.includes('quota') ||
      msg.includes('exceeded') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests') ||
      (msg.includes('plan') && msg.includes('limit'));

    return keyOrQuotaIssue || [401, 403, 429].includes(status);
  };

  const parseResponseBody = async (response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: text || `HTTP ${response.status}` };
    }
  };

  for (const apiKey of apiKeys) {
    try {
      const requestParams = new URLSearchParams(incoming);
      requestParams.set('api_key', apiKey);

      const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await parseResponseBody(response);

      if (shouldFailover(response.status, data)) {
        const reason = getSerpErrorMessage(data) || `HTTP ${response.status}`;
        logError(`Google AI Mode failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
        lastError = new Error(reason);
        continue;
      }

      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      if (isMetadataOnlyPayload(data)) {
        const rawHtmlUrl = String(data?.search_metadata?.raw_html_file || '').trim();
        if (rawHtmlUrl) {
          try {
            const htmlResp = await fetch(rawHtmlUrl, { method: 'GET' });
            if (htmlResp.ok) {
              const htmlText = await htmlResp.text();
              data.raw_html_text = String(htmlText || '').slice(0, 250000);
            } else {
              data.raw_html_fetch_error = `raw_html_http_${htmlResp.status}`;
            }
          } catch (htmlErr) {
            data.raw_html_fetch_error = htmlErr?.message || 'raw_html_fetch_failed';
          }
        }
      }

      return res.status(200).json(data);
    } catch (error) {
      logError(`Google AI Mode network error with key ${apiKey.slice(0, 8)}...:`, error.message);
      lastError = error;
      continue;
    }
  }

  logError('All SerpAPI keys failed for Google AI Mode');
  return res.status(500).json({
    error: 'Google AI Mode API error - all keys failed',
    details: lastError?.message || 'Unknown error'
  });
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };

