export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate license
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
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

    // Normalize inputs
    const keyword = params.get('keyword') || params.get('q') || '';
    const country = params.get('country') || params.get('gl') || '';

    if (!keyword || !country) {
      return res.status(400).json({ error: 'keyword and country are required' });
    }

    // Ensure required SerpApi params. Keep google_shopping as stable engine.
    params.set('engine', 'google_shopping');
    params.set('q', keyword);
    params.set('gl', country);
    params.set('hl', params.get('hl') || 'en');

    // Remove friendly params to avoid confusion
    params.delete('keyword');
    params.delete('country');

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

        // Remove stale page token when present.
        if (requestParams.get('page_token')) {
          requestParams.delete('page_token');
        }

        const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        const data = await parseResponseBody(response);
        const errorMessage = getSerpErrorMessage(data);

        if (shouldFailover(response.status, data)) {
          const reason = errorMessage || `HTTP ${response.status}`;
          console.error(`Immersive SerpApi failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
          lastError = new Error(reason);
          continue;
        }

        if (!response.ok) {
          return res.status(response.status).json(data);
        }

        return res.status(200).json(data);
      } catch (error) {
        console.error(`Immersive SerpApi network error with key ${apiKey.slice(0, 8)}...:`, error.message);
        lastError = error;
        continue;
      }
    }

    return res.status(500).json({
      error: 'Immersive Product API error - all keys failed',
      details: lastError?.message || 'Unknown error'
    });
  } catch (error) {
    console.error('Immersive Product API error:', error);
    return res.status(500).json({
      error: 'Immersive Product API error',
      details: error.message
    });
  }
}
