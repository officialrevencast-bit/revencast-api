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
  ].filter(Boolean); // Remove any undefined/null keys

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'No SerpAPI keys configured' });
  }

  const params = new URLSearchParams(req.query);
  let lastError = null;

  // Try each API key in sequence
  for (const apiKey of apiKeys) {
    try {
      // Create a fresh copy of params for each attempt
      const requestParams = new URLSearchParams(params);
      requestParams.append('api_key', apiKey);

      const response = await fetch(`https://serpapi.com/search?${requestParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      // If request was successful, return the response
      return res.status(response.status).json(data);
      
    } catch (error) {
      console.error(`SERP API error with key ${apiKey.slice(0, 8)}...:`, error.message);
      lastError = error;
      // Continue to next key
    }
  }

  // If we get here, all keys failed
  console.error('All SerpAPI keys failed');
  return res.status(500).json({ 
    error: 'SERP API error - all keys failed',
    details: lastError?.message || 'Unknown error'
  });
}
