module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-License-Key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

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
    
    // ADD YOUR SERPAPI KEY in Vercel environment variables
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
    console.error('SERP API proxy error:', error);
    return res.status(500).json({ 
      error: error.message,
      details: 'Check server logs'
    });
  }
};