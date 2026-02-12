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

  const params = new URLSearchParams(req.query);
  let lastError = null;

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

      const data = await response.json();
      
      // Check if SerpAPI returned an error that should trigger failover
      if (data.error) {
        const errorMsg = data.error.toLowerCase();
        
        // Detect various API key issues, quota exhaustion, and rate limiting
        if (
          errorMsg.includes('invalid api key') ||
          errorMsg.includes('api key not found') ||
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('run out of searches') ||
          errorMsg.includes('quota') ||
          errorMsg.includes('exceeded') ||
          errorMsg.includes('rate limit') ||
          errorMsg.includes('too many requests') ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 429
        ) {
          console.error(`SERP API error with key ${apiKey.slice(0, 8)}...: ${data.error}`);
          lastError = new Error(data.error);
          continue; // Try next key
        }
      }
      
      // If we get here, request was successful
      return res.status(response.status).json(data);
      
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
