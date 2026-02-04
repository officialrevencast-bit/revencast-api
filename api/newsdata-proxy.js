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

  const NEWS_API_KEY = process.env.NEWSDATA_KEY;
  if (!NEWS_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: NEWSDATA_KEY not set' });
  }

  try {
    const params = new URLSearchParams(req.query);

    // Country normalization + validation
    if (params.has('country')) {
      const raw = params.get('country') || '';
      const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);

      // Mapping from common country names (lowercase) to ISO codes (user-provided mapping)
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

        // If already a 2-letter code, accept as-is (lowercased)
        if (/^[a-z]{2}$/.test(lower)) {
          normalized.push(lower);
          continue;
        }

        // Try mapping from full name to code
        const mapped = nameToCode[lower];
        if (mapped) {
          normalized.push(mapped);
          continue;
        }

        // If not recognized, return a helpful error
        return res.status(400).json({
          error: `Invalid country value "${t}". Use ISO 3166-1 alpha-2 codes (lowercase) or one of the supported country names (e.g., "Spain" -> "es").`
        });
      }

      params.set('country', normalized.join(','));
    }

    // Attach API key and call the recommended 'latest' endpoint
    params.set('apikey', NEWS_API_KEY);
    const url = `https://newsdata.io/api/1/latest?${params.toString()}`;

    const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' }});
    const data = await response.json();

    // Forward status + body from NewsData
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('NewsData API error:', error);
    return res.status(500).json({
      error: 'NewsData API error',
      details: error.message
    });
  }
}
