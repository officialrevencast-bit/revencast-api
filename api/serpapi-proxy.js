export default async function handler(req, res) {
  const internalSecret = process.env.INTERNAL_PROXY_SECRET;
  const incomingSecret = req.headers['x-internal-secret'];
  if (!internalSecret || incomingSecret !== internalSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Set CORS headers
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
        console.error(`SERP API failover with key ${apiKey.slice(0, 8)}...: ${reason}`);
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
      console.error(`SERP API network error with key ${apiKey.slice(0, 8)}...:`, error.message);
      lastError = error;
      continue; // Try next key
    }
  }

  // If we get here, all keys failed
  console.error('All SerpAPI keys failed');
  return res.status(500).json({ 
    error: 'SERP API error - all keys failed',
    details: lastError?.message || 'Unknown error'
  });
}
