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

    // Normalize inputs
    const keyword = params.get('keyword') || params.get('q') || '';
    const country = params.get('country') || params.get('gl') || '';

    if (!keyword || !country) {
      return res.status(400).json({ error: 'keyword and country are required' });
    }

    // Ensure required SerpApi params
    // Note: google_immersive_product frequently requires page_token. Use google_shopping as a stable fallback.
    params.set('engine', 'google_shopping');
    params.set('q', keyword);
    params.set('gl', country);
    params.set('hl', params.get('hl') || 'en');
    params.append('api_key', process.env.SERPAPI_KEY);

    // Remove friendly params to avoid confusion
    params.delete('keyword');
    params.delete('country');

    let response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let data = await response.json();

    // If SerpApi returns a page_token error, retry with google_shopping
    if (!response.ok && data?.error && String(data.error).toLowerCase().includes('page_token')) {
      params.set('engine', 'google_shopping');
      params.delete('page_token');

      response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      data = await response.json();
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Immersive Product API error:', error);
    return res.status(500).json({
      error: 'Immersive Product API error',
      details: error.message
    });
  }
}
