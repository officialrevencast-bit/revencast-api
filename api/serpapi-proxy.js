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
    
    // Check if this is an immersive product search request
    const isProductSearch = params.get('type') === 'immersive_product';
    
    if (isProductSearch) {
      // Remove internal params
      params.delete('type');
      params.delete('service');
      
      // Build Immersive Product API URL
      const baseUrl = 'https://serpapi.com/search';
      params.append('api_key', process.env.SERPAPI_KEY);
      params.append('engine', 'google_product');
      params.append('product', params.get('product') || params.get('q') || '');
      
      // Add optional parameters
      if (params.get('location')) {
        params.append('location', params.get('location'));
      }
      if (params.get('country')) {
        params.append('gl', params.get('country'));
      }
      
      // Ensure we get detailed results
      params.append('num', params.get('num') || '20');
      params.append('tbm', 'shop');
      
      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      return res.status(response.status).json(data);
      
    } else {
      // Original SERP API code (keep for backward compatibility)
      params.append('api_key', process.env.SERPAPI_KEY);

      const response = await fetch(`https://serpapi.com/search?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }
    
  } catch (error) {
    console.error('SERP API error:', error);
    return res.status(500).json({ 
      error: 'SERP API error',
      details: error.message 
    });
  }
}
