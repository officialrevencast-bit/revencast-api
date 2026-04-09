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
    process.env.SERPAPI_KEY_2
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const params = new URLSearchParams(req.method === 'POST' ? req.body : req.query);
  
  // Ensure engine is google_forums
  params.set('engine', 'google_forums');

  const q = params.get('q');
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

      const payload = await parseResponseBody(response);

      if (!response.ok) {
        lastError = { status: response.status, payload };
        logError(`google-forums-proxy: API key failed (${response.status}):`, payload);

        if (!shouldFailover(response.status, payload)) {
          return res.status(response.status).json(payload);
        }
        continue;
      }

      // Extract top results and structure the response
      const organicResults = payload.organic_results || [];
      const relatedSearches = payload.related_searches || [];

      // Take top 5 forum discussions
      const topForums = organicResults.slice(0, 5).map((result) => ({
        position: result.position,
        title: result.title,
        link: result.link,
        source: result.source || 'Unknown',
        snippet: result.snippet,
        displayMeta: result.displayed_meta,
        answers: (result.answers || []).slice(0, 3).map((a) => ({
          answer: a.answer,
          votes: a.votes,
          topAnswer: a.top_answer
        }))
      }));

      return res.status(200).json({
        success: true,
        forums: topForums,
        relatedSearches: relatedSearches.slice(0, 5),
        totalResults: payload.search_information?.total_results || 0
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
