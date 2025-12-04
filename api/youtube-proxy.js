export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // License validation
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  try {
    const { q, maxResults = 10, type = 'video' } = req.body;
    
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Missing required parameter: q' });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
    }

    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=${type}&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${apiKey}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('YouTube API error:', error);
    return res.status(500).json({ 
      error: 'YouTube API error',
      details: error.message 
    });
  }
}