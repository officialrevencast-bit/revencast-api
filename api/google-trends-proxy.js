'use strict';

const DEBUG_LOGS =
  String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' ||
  process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

function normalizeKeywordList(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGeo(geo) {
  const raw = String(geo || '').trim();
  if (!raw || raw.toLowerCase() === 'global') return '';
  const lower = raw.toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) return lower.toUpperCase();

  const nameToCode = {
    'united states': 'US',
    'united kingdom': 'GB',
    canada: 'CA',
    australia: 'AU',
    germany: 'DE',
    france: 'FR',
    italy: 'IT',
    spain: 'ES',
    india: 'IN',
    brazil: 'BR',
    japan: 'JP',
    mexico: 'MX',
    'south korea': 'KR',
    russia: 'RU',
    'south africa': 'ZA',
    netherlands: 'NL',
    switzerland: 'CH',
    singapore: 'SG',
    'united arab emirates': 'AE',
    'saudi arabia': 'SA',
    turkey: 'TR',
    sweden: 'SE',
    norway: 'NO',
    denmark: 'DK',
    finland: 'FI',
    ireland: 'IE',
    poland: 'PL',
    portugal: 'PT',
    belgium: 'BE',
    austria: 'AT',
    'new zealand': 'NZ',
    argentina: 'AR',
    chile: 'CL',
    colombia: 'CO',
    peru: 'PE',
    thailand: 'TH',
    vietnam: 'VN',
    indonesia: 'ID',
    malaysia: 'MY',
    philippines: 'PH',
    pakistan: 'PK',
    bangladesh: 'BD',
    egypt: 'EG',
    nigeria: 'NG',
    kenya: 'KE',
    ghana: 'GH'
  };

  return nameToCode[lower] || '';
}

function buildKeywordMetrics(timelineData, requestedKeywords) {
  const byKeyword = new Map();

  for (const keyword of requestedKeywords) {
    byKeyword.set(keyword, {
      keyword,
      points: [],
      first: null,
      last: null
    });
  }

  const normalizedTimeline = (Array.isArray(timelineData) ? timelineData : []).map((entry) => {
    const values = Array.isArray(entry?.values) ? entry.values : [];
    const normalizedValues = values.map((v) => {
      const query = String(v?.query || '').trim();
      const extracted = Number(v?.extracted_value ?? v?.value ?? 0);
      const point = {
        query,
        extracted_value: Number.isFinite(extracted) ? extracted : 0
      };

      if (byKeyword.has(query)) {
        const bucket = byKeyword.get(query);
        bucket.points.push(point.extracted_value);
        if (bucket.first === null) bucket.first = point.extracted_value;
        bucket.last = point.extracted_value;
      }
      return point;
    });

    return {
      date: String(entry?.date || '').trim(),
      timestamp: String(entry?.timestamp || '').trim(),
      values: normalizedValues
    };
  });

  const keyword_metrics = [];
  for (const keyword of requestedKeywords) {
    const bucket = byKeyword.get(keyword) || { points: [], first: null, last: null };
    const points = bucket.points;
    const avg = points.length ? points.reduce((sum, n) => sum + n, 0) / points.length : 0;
    const start = bucket.first == null ? 0 : bucket.first;
    const end = bucket.last == null ? 0 : bucket.last;
    const change = end - start;
    let direction = 'flat';
    if (change > 2) direction = 'rising';
    if (change < -2) direction = 'falling';

    keyword_metrics.push({
      keyword,
      average_interest: Number(avg.toFixed(2)),
      start_interest: start,
      end_interest: end,
      change,
      direction
    });
  }

  const comparison = [...keyword_metrics].sort((a, b) => b.average_interest - a.average_interest);

  return {
    timeline_data: normalizedTimeline,
    keyword_metrics,
    comparison
  };
}

async function parseResponseBody(response) {
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
}

function getSerpErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return (
    payload.error ||
    payload.message ||
    payload?.search_metadata?.error ||
    payload?.search_metadata?.status ||
    payload?.error_message ||
    ''
  );
}

function shouldFailover(status, payload) {
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
}

async function handler(req, res) {
  const { authorizeRequest, setCors } = await import('./_auth-utils.js');
  setCors(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKeys = [process.env.SERPAPI_KEY, process.env.SERPAPI_KEY_2].filter(Boolean);
  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const keywordsRaw = req.body?.keywords ?? req.body?.q;
  const keywords = normalizeKeywordList(keywordsRaw).slice(0, 5);
  if (keywords.length < 1) {
    return res.status(400).json({ error: 'At least one keyword is required' });
  }

  const geo = normalizeGeo(req.body?.geo || req.body?.country || '');
  const date = String(req.body?.date || 'today 12-m').trim() || 'today 12-m';

  let lastError = null;

  for (const apiKey of apiKeys) {
    try {
      const requestParams = new URLSearchParams();
      requestParams.set('engine', 'google_trends');
      requestParams.set('q', keywords.join(','));
      requestParams.set('data_type', 'TIMESERIES');
      requestParams.set('date', date);
      if (geo) requestParams.set('geo', geo);
      requestParams.set('api_key', apiKey);

      const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const payload = await parseResponseBody(response);

      if (shouldFailover(response.status, payload)) {
        const reason = getSerpErrorMessage(payload) || `HTTP ${response.status}`;
        logError(`Google Trends failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
        lastError = new Error(reason);
        continue;
      }

      if (!response.ok) {
        return res.status(response.status).json(payload);
      }

      const timeline = Array.isArray(payload?.interest_over_time?.timeline_data)
        ? payload.interest_over_time.timeline_data
        : [];
      const processed = buildKeywordMetrics(timeline, keywords);

      return res.status(200).json({
        success: true,
        search_parameters: {
          engine: 'google_trends',
          data_type: 'TIMESERIES',
          q: keywords,
          geo: geo || 'GLOBAL',
          date
        },
        timeline_data: processed.timeline_data,
        keyword_metrics: processed.keyword_metrics,
        keyword_comparison: processed.comparison,
        raw_averages: Array.isArray(payload?.interest_over_time?.averages)
          ? payload.interest_over_time.averages
          : []
      });
    } catch (error) {
      logError(`Google Trends network error with key ${apiKey.slice(0, 8)}...:`, error.message);
      lastError = error;
      continue;
    }
  }

  return res.status(500).json({
    error: 'Google Trends API error - all keys failed',
    details: lastError?.message || 'Unknown error'
  });
}

module.exports = handler;
module.exports.config = { runtime: 'nodejs' };

