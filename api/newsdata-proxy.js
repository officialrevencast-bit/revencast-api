// newsdata-proxy.js
export default async function handler(req, res) {
  const internalSecret = process.env.INTERNAL_PROXY_SECRET;
  const incomingSecret = req.headers['x-internal-secret'];
  if (!internalSecret || incomingSecret !== internalSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key, X-Internal-Secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKeys = [
    process.env.SERPAPI_KEY,
    process.env.SERPAPI_KEY_2
  ].filter(Boolean);

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  try {
    const params = new URLSearchParams(req.query);

    // Normalize country for SerpApi "gl" (geo location) when provided
    if (params.has('country')) {
      const raw = params.get('country') || '';
      const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);

      // Mapping from common country names (lowercase) to ISO codes
      const nameToCode = {
        'united states': 'us', 'united kingdom': 'gb', 'canada': 'ca',
        'australia': 'au', 'germany': 'de', 'france': 'fr',
        'italy': 'it', 'spain': 'es', 'japan': 'jp', 'china': 'cn',
        'india': 'in', 'brazil': 'br', 'mexico': 'mx', 'south korea': 'kr',
        'russia': 'ru', 'south africa': 'za', 'netherlands': 'nl',
        'switzerland': 'ch', 'singapore': 'sg', 'united arab emirates': 'ae',
        'saudi arabia': 'sa', 'turkey': 'tr', 'sweden': 'se', 'norway': 'no',
        'denmark': 'dk', 'finland': 'fi', 'ireland': 'ie', 'poland': 'pl',
        'portugal': 'pt', 'belgium': 'be', 'austria': 'at', 'new zealand': 'nz',
        'argentina': 'ar', 'chile': 'cl', 'colombia': 'co', 'peru': 'pe',
        'thailand': 'th', 'vietnam': 'vn', 'indonesia': 'id', 'malaysia': 'my',
        'philippines': 'ph', 'pakistan': 'pk', 'bangladesh': 'bd', 'egypt': 'eg',
        'nigeria': 'ng', 'kenya': 'ke', 'ghana': 'gh'
      };

      const normalized = [];

      for (const t of tokens) {
        const lower = t.toLowerCase();
        if (/^[a-z]{2}$/.test(lower)) {
          normalized.push(lower);
          continue;
        }
        const mapped = nameToCode[lower];
        if (mapped) {
          normalized.push(mapped);
        }
      }

      if (normalized.length) {
        params.set('gl', normalized[0]);
      }

      params.delete('country');
    }

    // Force Google News engine.
    params.set('engine', 'google_news');
    if (!params.has('gl')) {
      params.set('gl', 'us');
    }

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

    let lastError = null;

    for (const apiKey of apiKeys) {
      try {
        const requestParams = new URLSearchParams(params);
        requestParams.set('api_key', apiKey);
        const url = `https://serpapi.com/search?${requestParams.toString()}`;

        const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' }});
        const data = await parseResponseBody(response);
        const errorMessage = getSerpErrorMessage(data);

        if (shouldFailover(response.status, data)) {
          const reason = errorMessage || `HTTP ${response.status}`;
          console.error(`Google News failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
          lastError = new Error(reason);
          continue;
        }

        if (!response.ok) {
          return res.status(response.status).json(data);
        }

        return res.status(200).json(data);
      } catch (error) {
        console.error(`Google News network error with key ${apiKey.slice(0, 8)}...:`, error.message);
        lastError = error;
        continue;
      }
    }

    return res.status(500).json({
      error: 'Google News API error - all keys failed',
      details: lastError?.message || 'Unknown error'
    });

  } catch (error) {
    console.error('Google News (SerpApi) error:', error);
    return res.status(500).json({
      error: 'Google News API error',
      details: error.message
    });
  }
}
