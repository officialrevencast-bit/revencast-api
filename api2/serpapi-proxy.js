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

  try {
    const params = new URLSearchParams(req.query);
    params.append('api_key', process.env.SERPAPI_KEY);

    const response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('SERP API error:', error);
    return res.status(500).json({ 
      error: 'SERP API error',
      details: error.message 
    });
  }
}