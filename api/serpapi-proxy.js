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
    const countryParam = req.query.target_country || req.query.country || req.query.gl || req.query.location || '';

    // Normalize country parameter to a 2-letter ISO code that SerpApi accepts
    function normalizeCountry(c) {
      if (!c) return '';
      const map = {
        'united states': 'US','us': 'US','united kingdom': 'GB','uk': 'GB','gb': 'GB',
        'canada': 'CA','ca': 'CA','australia': 'AU','au': 'AU','germany': 'DE','de': 'DE',
        'france': 'FR','fr': 'FR','italy': 'IT','it': 'IT','spain': 'ES','es': 'ES',
        'japan': 'JP','jp': 'JP','china': 'CN','cn': 'CN','india': 'IN','in': 'IN',
        'brazil': 'BR','br': 'BR','mexico': 'MX','mx': 'MX','south korea': 'KR','kr': 'KR',
        'korea': 'KR','russia': 'RU','ru': 'RU','south africa': 'ZA','za': 'ZA',
        'netherlands': 'NL','nl': 'NL','switzerland': 'CH','ch': 'CH','singapore': 'SG','sg': 'SG',
        'united arab emirates': 'AE','uae': 'AE','saudi arabia': 'SA','sa': 'SA','turkey': 'TR','tr': 'TR',
        'sweden': 'SE','se': 'SE','norway': 'NO','no': 'NO','denmark': 'DK','dk': 'DK','finland': 'FI','fi': 'FI',
        'ireland': 'IE','ie': 'IE','poland': 'PL','pl': 'PL','portugal': 'PT','pt': 'PT','belgium': 'BE','be': 'BE',
        'austria': 'AT','at': 'AT','new zealand': 'NZ','nz': 'NZ','argentina': 'AR','ar': 'AR','chile': 'CL','cl': 'CL',
        'colombia': 'CO','co': 'CO','peru': 'PE','pe': 'PE','thailand': 'TH','th': 'TH','vietnam': 'VN','vn': 'VN',
        'indonesia': 'ID','id': 'ID','malaysia': 'MY','my': 'MY','philippines': 'PH','ph': 'PH','pakistan': 'PK','pk': 'PK',
        'bangladesh': 'BD','bd': 'BD','egypt': 'EG','eg': 'EG','nigeria': 'NG','ng': 'NG','kenya': 'KE','ke': 'KE','ghana': 'GH','gh': 'GH'
      };

      const key = c.toString().trim().toLowerCase();
      if (map[key]) return map[key];
      // If it's already a two-letter code, use it
      if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();

      // Try to match by prefix (e.g., 'united' -> 'US' is ambiguous, so avoid)
      // Return empty to indicate not recognized
      return '';
    }

    const normalizedCountry = normalizeCountry(countryParam);

    // If user provided a country but it could not be normalized, return helpful error
    if (countryParam && !normalizedCountry) {
      return res.status(400).json({
        error: 'Unsupported country parameter',
        details: `Unsupported country: ${countryParam}. Provide a 2-letter ISO country code (e.g. "IN") or common country name (e.g. "India").`
      });
    }

    // Compose a stronger query by combining product name and a short description
    let composedQuery = productName.trim();
    if (productDescription && productDescription.trim()) {
      composedQuery = `${composedQuery} ${productDescription.trim()}`.trim();
    }

    // Primary: Google Immersive Product API via SerpApi
    const params = new URLSearchParams();
    if (composedQuery) params.append('q', composedQuery);
    if (normalizedCountry) params.append('gl', normalizedCountry);
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
      if (normalizedCountry) fallbackParams.append('gl', normalizedCountry);
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
