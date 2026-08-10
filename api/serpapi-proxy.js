import { authorizeRequest, setCors } from './_auth-utils.js';

const DEBUG_LOGS = String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' || process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

const COUNTRY_TO_GL = {
  'united states': 'us', 'united kingdom': 'gb', canada: 'ca', australia: 'au', germany: 'de', france: 'fr',
  italy: 'it', spain: 'es', india: 'in', brazil: 'br', japan: 'jp', mexico: 'mx', 'south korea': 'kr',
  russia: 'ru', 'south africa': 'za', netherlands: 'nl', switzerland: 'ch', singapore: 'sg',
  'united arab emirates': 'ae', 'saudi arabia': 'sa', turkey: 'tr', sweden: 'se', norway: 'no',
  denmark: 'dk', finland: 'fi', ireland: 'ie', poland: 'pl', portugal: 'pt', belgium: 'be', austria: 'at',
  'new zealand': 'nz', argentina: 'ar', chile: 'cl', colombia: 'co', peru: 'pe', thailand: 'th',
  vietnam: 'vn', indonesia: 'id', malaysia: 'my', philippines: 'ph', pakistan: 'pk', bangladesh: 'bd',
  egypt: 'eg', nigeria: 'ng', kenya: 'ke', ghana: 'gh', israel: 'il', qatar: 'qa', kuwait: 'kw',
  bahrain: 'bh', oman: 'om', jordan: 'jo', lebanon: 'lb', china: 'cn', taiwan: 'tw', 'hong kong': 'hk'
};

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'global') return '';
  if (/^[a-z]{2}$/.test(raw)) return raw;
  return COUNTRY_TO_GL[raw] || '';
}

function parseJsonSafe(response) {
  return response.text().then((text) => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text || `HTTP ${response.status}` };
    }
  });
}

function normalizeSerperResults(payload, type) {
  const rows = type === 'news'
    ? (Array.isArray(payload?.news) ? payload.news : [])
    : (Array.isArray(payload?.organic) ? payload.organic : []);

  return rows
    .map((row, index) => ({
      position: Number(row?.position || index + 1),
      title: String(row?.title || '').trim(),
      url: String(row?.link || row?.url || '').trim(),
      snippet: String(row?.snippet || '').trim(),
      source: String(row?.source || row?.displayLink || row?.displayed_link || '').trim(),
      published_at: String(row?.date || row?.datePublished || row?.published_at || '').trim(),
      image_url: String(row?.imageUrl || row?.image_url || '').trim(),
      provider: 'serper'
    }))
    .filter((item) => item.title && /^https:\/\//i.test(item.url))
    .slice(0, 10);
}

const SOURCE_DOMAIN_RULES = {
  public_posts: ['reddit.com', 'quora.com'],
  news: ['reuters.com']
};

function isAllowedSourceUrl(value, allowedDomains) {
  try {
    const parsed = new URL(String(value || ''));
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname || '/';
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password || !path || path === '/') return false;
    if (/^\/(?:search|results)(?:\/|$)/i.test(path)) return false;
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function readHtmlPreview(response, maxBytes = 64000) {
  const reader = response.body?.getReader?.();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let output = '';
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value || new Uint8Array();
      const remaining = maxBytes - total;
      output += decoder.decode(chunk.slice(0, remaining), { stream: total + chunk.length < maxBytes });
      total += chunk.length;
      if (chunk.length > remaining) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* no-op */ }
  }
  return output;
}

function extractPageTitle(html) {
  const match = String(html || '').match(/<title[^>]*>\s*([^<]{1,300})\s*<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function isUnavailablePage(html, pageTitle) {
  const sample = `${pageTitle}\n${String(html || '').replace(/<[^>]*>/g, ' ').slice(0, 12000)}`.toLowerCase();
  return /\b(?:page not found|404 not found|this page is unavailable|content unavailable|this content is unavailable|page has been deleted|post has been deleted|post was deleted|removed by reddit|access denied|temporarily unavailable|captcha)\b/.test(sample);
}

async function validateSourceCandidate(candidate, kind) {
  const allowedDomains = SOURCE_DOMAIN_RULES[kind] || [];
  const originalUrl = String(candidate?.url || candidate?.link || '').trim();
  if (!isAllowedSourceUrl(originalUrl, allowedDomains)) return { ok: false, reason: 'invalid_source_url' };

  let currentUrl = originalUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'RevencastSourceValidator/1.0 (+https://revencast.com)' },
        signal: controller.signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        if (!next) return { ok: false, reason: 'redirect_without_location' };
        currentUrl = new URL(next, currentUrl).toString();
        if (!isAllowedSourceUrl(currentUrl, allowedDomains)) return { ok: false, reason: 'redirect_outside_source' };
        continue;
      }
      if (response.status !== 200) return { ok: false, reason: `http_${response.status}` };
      if (!String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
        return { ok: false, reason: 'not_html' };
      }
      const html = await readHtmlPreview(response);
      const pageTitle = extractPageTitle(html);
      if (isUnavailablePage(html, pageTitle)) return { ok: false, reason: 'unavailable_page' };
      return {
        ok: true,
        item: {
          title: String(candidate?.title || pageTitle || '').trim(),
          url: currentUrl,
          original_url: originalUrl,
          snippet: String(candidate?.snippet || '').trim(),
          source: String(candidate?.source || '').trim(),
          published_at: String(candidate?.published_at || candidate?.date || '').trim(),
          provider: 'serper',
          expected_domain: allowedDomains,
          candidate_status: 'validated',
          page_title: pageTitle,
          validated_at: new Date().toISOString()
        }
      };
    }
    return { ok: false, reason: 'too_many_redirects' };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'validation_timeout' : 'validation_network_error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateSourceGroup(items, kind) {
  const input = Array.isArray(items) ? items.slice(0, 3) : [];
  const results = await Promise.all(input.map((item) => validateSourceCandidate(item, kind)));
  return {
    validated: results.filter((result) => result.ok).map((result) => result.item).slice(0, 3),
    rejected: results.map((result, index) => ({ result, index })).filter(({ result }) => !result.ok).map(({ result, index }) => ({
      url: String(input[index]?.url || input[index]?.link || '').trim(), reason: result.reason
    }))
  };
}

async function handleSourceCandidateValidation(req, res) {
  const body = req.body || {};
  const [publicPosts, news] = await Promise.all([
    validateSourceGroup(body.public_posts, 'public_posts'),
    validateSourceGroup(body.news, 'news')
  ]);
  return res.status(200).json({
    validation_version: 'server-url-validation-v1',
    validated_at: new Date().toISOString(),
    public_posts: publicPosts.validated,
    news: news.validated,
    rejected: { public_posts: publicPosts.rejected, news: news.rejected }
  });
}

async function handleSerperSourceResearch(req, res) {
  const body = req.body || {};
  const type = String(body.type || '').trim().toLowerCase();
  const query = String(body.query || '').trim().replace(/\s+/g, ' ');
  const gl = normalizeCountryCode(body.country_code || body.target_country || body.country);
  const hl = /^[a-z]{2}$/i.test(String(body.language || 'en')) ? String(body.language || 'en').toLowerCase() : 'en';

  if (!['public_posts', 'news'].includes(type)) {
    return res.status(400).json({ error: 'type must be public_posts or news' });
  }
  if (!query || query.length > 1200) {
    return res.status(400).json({ error: 'A search query between 1 and 1200 characters is required' });
  }

  const apiKey = String(process.env.SERPER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'SERPER_API_KEY is not configured' });
  }

  const endpointType = type === 'news' ? 'news' : 'search';
  try {
    const response = await fetch(`https://google.serper.dev/${endpointType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey
      },
      body: JSON.stringify({
        q: query,
        ...(gl ? { gl } : {}),
        hl,
        tbs: 'qdr:y',
        num: 10
      })
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      logError('Serper source research failed:', response.status, payload?.error || payload?.message || 'unknown error');
      return res.status(response.status).json({
        error: 'Serper source research failed',
        details: payload?.message || payload?.error || `serper_${response.status}`
      });
    }

    return res.status(200).json({
      provider: 'serper',
      type,
      search_parameters: { q: query, gl: gl || 'GLOBAL', hl, tbs: 'qdr:y' },
      results: normalizeSerperResults(payload, type)
    });
  } catch (error) {
    logError('Serper source research network error:', error?.message || error);
    return res.status(502).json({ error: 'Serper source research unavailable', details: error?.message || 'network_error' });
  }
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  // Phase 1 source discovery uses this existing handler so deployment stays
  // within Vercel's current serverless-function limit.
  if (req.method === 'POST') {
    const action = String(req.body?.action || '').trim();
    if (action === 'source_research') return handleSerperSourceResearch(req, res);
    if (action === 'validate_source_candidates') return handleSourceCandidateValidation(req, res);
    return res.status(400).json({ error: 'Unsupported POST action' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKeys = [
    process.env.SERPAPI_KEY,
    process.env.SERPAPI_KEY_2,
    process.env.SERPAPI_KEY_3,
    process.env.SERPAPI_KEY_4,
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const params = new URLSearchParams(req.query);
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
      msg.includes('plan') && msg.includes('limit');

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

  // Try each API key in sequence
  for (const apiKey of apiKeys) {
    try {
      const requestParams = new URLSearchParams(params);
      requestParams.append('api_key', apiKey);

      const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await parseResponseBody(response);
      const errorMessage = getSerpErrorMessage(data);

      if (shouldFailover(response.status, data)) {
        const reason = errorMessage || `HTTP ${response.status}`;
          logError(`SERP API failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
        lastError = new Error(reason);
        continue; // Try next key
      }

      // For non-failover errors (e.g. bad query), return immediately.
      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      // Success.
      return res.status(200).json(data);
    } catch (error) {
        logError(`SERP API network error with key ${apiKey.slice(0, 8)}...:`, error.message);
      lastError = error;
      continue; // Try next key
    }
  }

  // If we get here, all keys failed
  logError('All SerpAPI keys failed');
  return res.status(500).json({ 
    error: 'SERP API error - all keys failed',
    details: lastError?.message || 'Unknown error'
  });
}
