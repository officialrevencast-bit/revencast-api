import { authorizeRequest, setCors } from './_auth-utils.js';

const DEBUG_LOGS = String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' || process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

export default async function handler(req, res) {
  setCors(res, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const auth = await authorizeRequest(req, res);
  if (!auth || !auth.ok) return;

  const apiKeys = [
    process.env.SERPAPI_KEY,
    process.env.SERPAPI_KEY_2,
    process.env.SERPAPI_KEY_3
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const params = new URLSearchParams(req.method === 'POST' ? req.body : req.query);
  const q = params.get('q');
  const gl = String(params.get('gl') || 'us').trim().toLowerCase() || 'us';
  if (!q) {
    return res.status(400).json({ error: 'Missing required parameter: q' });
  }

  // Fixed time range: past 1 year. No other filters applied.
  const timeRange = 'y';

  const baseParams = new URLSearchParams();
  baseParams.set('engine', 'google');
  baseParams.set('q', q);
  baseParams.set('gl', gl);
  baseParams.set('udm', '18');
  baseParams.set('tbs', `qdr:${timeRange}`);

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

  const mapDiscussionItem = (item) => ({
    link: String(item?.link || '').trim(),
    top_answer: Boolean(item?.top_answer),
    votes: Number(item?.votes || 0)
  });

  const mapDiscussionForum = (result) => {
    const items = Array.isArray(result?.items) ? result.items : [];
    const comments = Number(result?.comments || 0);
    const extensions = Array.isArray(result?.extensions) ? result.extensions.map((item) => String(item || '').trim()).filter(Boolean) : [];
    return {
      position: result.position ?? null,
      title: String(result.title || '').trim(),
      link: String(result.link || '').trim(),
      source: String(result.source || 'Unknown').trim(),
      date: String(result.date || '').trim(),
      comments,
      displayedMeta: [result.source, comments ? `${comments}+ comments` : '', ...extensions].filter(Boolean).join(' • '),
      answers: items.slice(0, 5).map(mapDiscussionItem),
      icon: String(result.icon || '').trim()
    };
  };

  const mapRelatedSearch = (item) => ({
    blockPosition: Number(item?.block_position || 0),
    query: String(item?.query || '').trim(),
    link: String(item?.link || '').trim(),
    serpapiLink: String(item?.serpapi_link || '').trim()
  });

  // Try each API key in sequence
  for (const apiKey of apiKeys) {
    try {
      const requestParams = new URLSearchParams(baseParams);
      requestParams.append('api_key', apiKey);

      const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const payload = await parseResponseBody(response);

      if (!response.ok) {
        lastError = { status: response.status, payload };
        logError(`google-forums-proxy: API key failed (${response.status}):`, payload);

        if (!shouldFailover(response.status, payload)) {
          return res.status(response.status).json(payload);
        }
        continue;
      }

      // DEBUG: Log full SerpAPI response structure
      console.log('[SERPAPI-RESPONSE]', JSON.stringify(payload, null, 2));
      console.log('[SERPAPI-KEYS]', Object.keys(payload));
      console.log('[SERPAPI-DISCUSSIONS]', payload.discussions_and_forums?.length ?? 0);
      console.log('[SERPAPI-ORGANIC]', payload.organic_results?.length ?? 0);

      // Extract useful discussion/forum signals and structure the response
      const discussions = Array.isArray(payload.discussions_and_forums)
        ? payload.discussions_and_forums
        : Array.isArray(payload.organic_results)
          ? payload.organic_results
          : [];
      const relatedSearches = Array.isArray(payload.related_searches) ? payload.related_searches : [];
      const pagination = payload.serpapi_pagination || {};

      console.log('[EXTRACTED]', { discussions_count: discussions.length, related_count: relatedSearches.length });

      // Keep the most relevant discussions, but preserve the rich metadata for synthesis.
      const topForums = discussions.slice(0, 8).map(mapDiscussionForum);

      return res.status(200).json({
        success: true,
        query: String(q),
        time_range: timeRange || null,
        forums: topForums,
        relatedSearches: relatedSearches.slice(0, 5).map(mapRelatedSearch),
        totalResults: payload.search_information?.total_results || 0,
        searchInformation: payload.search_information || {},
        pagination: {
          current: pagination.current || null,
          next: String(pagination.next || '').trim(),
          previous: String(pagination.previous || '').trim()
        }
      });
    } catch (error) {
      lastError = error;
      logError('google-forums-proxy: Network error:', error);
      continue;
    }
  }

  logError('google-forums-proxy: All keys exhausted', lastError);
  return res.status(500).json({
    error: 'Failed to fetch forum data',
    details: lastError?.payload?.error || lastError?.message || 'Unknown error'
  });
}