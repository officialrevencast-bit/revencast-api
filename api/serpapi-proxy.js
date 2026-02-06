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
    // Build params (allow the client to send product_name/product_description for immersive queries)
    const params = new URLSearchParams(req.query);

    // If the client requested the Immersive Product engine but didn't provide a query, build one
    if ((req.query.engine === 'google_immersive_product' || req.query.engine === 'google_immersive_product') && !req.query.q) {
      let builtQ = '';
      if (req.query.product_name) builtQ += req.query.product_name;
      if (req.query.product_description) {
        const descWords = String(req.query.product_description).split(/\s+/).slice(0, 40).join(' ');
        builtQ += (builtQ ? ' ' : '') + descWords;
      }
      if (req.query.business_category) builtQ += (builtQ ? ' ' : '') + req.query.business_category;
      if (req.query.country) builtQ += (builtQ ? ' ' : '') + req.query.country;

      if (builtQ) {
        params.set('q', builtQ);
        params.set('product_query', builtQ);
      }

      // Allow passing a country code as gl for locale-specific results
      if (req.query.country_code) params.set('gl', req.query.country_code);
    }


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
