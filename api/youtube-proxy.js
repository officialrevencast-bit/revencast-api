module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-License-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // license header validation (same as your openai-proxy)
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  try {
    const body = req.body || {};
    const q = (body.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Missing required parameter: q' });
    }

    const maxResults = body.maxResults ? Number(body.maxResults) : 10;
    const type = body.type || 'video'; // video|channel|playlist
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
    }

    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&maxResults=${encodeURIComponent(maxResults)}&key=${encodeURIComponent(apiKey)}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await resp.json();

    return res.status(resp.status).json(data);
  } catch (err) {
    console.error('YouTube proxy error:', err);
    return res.status(500).json({ 
      error: err.message,
      details: 'Check server logs'
    });
  }
};