// newsdata-proxy.js
export default async function handler(req, res) {
  // CORS
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

  const SERP_API_KEY = process.env.SERPAPI_KEY;
  if (!SERP_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: SERPAPI_KEY not set' });
  }

  try {
    const params = new URLSearchParams(req.query);

    // Normalize country for SerpApi "gl" (geo location) when provided
    if (params.has('country')) {
      const raw = params.get('country') || '';
      const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);

      // Mapping from common country names (lowercase) to ISO codes
      const nameToCode = {
        'united states': 'us', 'united kingdom': 'gb', 'canada': 'ca',
        'australia': 'au', 'germany': 'de', 'france': 'fr',
        'italy': 'it', 'spain': 'es', 'japan': 'jp', 'china': 'cn',
        'india': 'in', 'brazil': 'br', 'mexico': 'mx', 'south korea': 'kr',
        'russia': 'ru', 'south africa': 'za', 'netherlands': 'nl',
        'switzerland': 'ch', 'singapore': 'sg', 'united arab emirates': 'ae',
        'saudi arabia': 'sa', 'turkey': 'tr', 'sweden': 'se', 'norway': 'no',
        'denmark': 'dk', 'finland': 'fi', 'ireland': 'ie', 'poland': 'pl',
        'portugal': 'pt', 'belgium': 'be', 'austria': 'at', 'new zealand': 'nz',
        'argentina': 'ar', 'chile': 'cl', 'colombia': 'co', 'peru': 'pe',
        'thailand': 'th', 'vietnam': 'vn', 'indonesia': 'id', 'malaysia': 'my',
        'philippines': 'ph', 'pakistan': 'pk', 'bangladesh': 'bd', 'egypt': 'eg',
        'nigeria': 'ng', 'kenya': 'ke', 'ghana': 'gh'
      };

      const normalized = [];

      for (const t of tokens) {
        const lower = t.toLowerCase();
        if (/^[a-z]{2}$/.test(lower)) {
          normalized.push(lower);
          continue;
        }
        const mapped = nameToCode[lower];
        if (mapped) {
          normalized.push(mapped);
        }
      }

      if (normalized.length) {
        params.set('gl', normalized[0]);
      }

      params.delete('country');
    }

    // Force Google News engine and attach API key
    params.set('engine', 'google_news');
    params.set('api_key', SERP_API_KEY);
    if (!params.has('gl')) {
      params.set('gl', 'us');
    }

    const url = `https://serpapi.com/search?${params.toString()}`;

    const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' }});
    const data = await response.json();

    // Forward status + body from SerpApi
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('Google News (SerpApi) error:', error);
    return res.status(500).json({
      error: 'Google News API error',
      details: error.message
    });
  }
}
