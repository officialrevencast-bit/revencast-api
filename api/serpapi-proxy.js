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
    // Build search query - accept product name/description + country
    const productName = req.query.product_name || req.query.q || '';
    const productDescription = req.query.product_description || '';
    const country = req.query.target_country || req.query.country || req.query.gl || req.query.location || '';

    // Compose a stronger query by combining product name and a short description
    let composedQuery = productName.trim();
    if (productDescription && productDescription.trim()) {
      composedQuery = `${composedQuery} ${productDescription.trim()}`.trim();
    }

    // Primary: Google Immersive Product API via SerpApi
    const params = new URLSearchParams();
    if (composedQuery) params.append('q', composedQuery);
    if (country) params.append('gl', country);
    params.append('engine', 'google_immersive_product');
    params.append('api_key', process.env.SERPAPI_KEY);

    // Try immersive product first
    let response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    // If immersive returns non-OK or no product info, fall back to shopping search
    let data = await response.json().catch(() => ({}));

    const hasProducts = (data && (data.products || (data.shopping_results && data.shopping_results.length > 0)));

    if (!response.ok || !hasProducts) {
      // Fallback to google shopping engine (more general)
      const fallbackParams = new URLSearchParams();
      if (composedQuery) fallbackParams.append('q', composedQuery);
      if (country) fallbackParams.append('gl', country);
      fallbackParams.append('engine', 'google');
      fallbackParams.append('tbm', 'shop');
      fallbackParams.append('api_key', process.env.SERPAPI_KEY);

      const fallbackResp = await fetch(`https://serpapi.com/search?${fallbackParams.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      data = await fallbackResp.json().catch(() => ({}));
      return res.status(fallbackResp.status).json(data);
    }

    return res.status(response.status).json(data);

  } catch (error) {
    console.error('SERP API error:', error);
    return res.status(500).json({ error: 'SERP API error', details: error.message });
  }
}
