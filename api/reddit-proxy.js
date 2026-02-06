let cachedToken = null;

async function getRedditAppToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.token && cachedToken.expiryMs && now < cachedToken.expiryMs - 60_000) {
    return cachedToken.token;
  }

  const clientId = "YJ-wcP9Bz-uCK857l3xV2g";
  const userAgent = "RevenCast/1.0";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing reddit client id or secret');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": userAgent
    },
    body: "grant_type=client_credentials"
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to acquire reddit token: ${res.status} ${txt}`);
  }

  const json = await res.json();
  if (!json || !json.access_token) {
    throw new Error(`Invalid token response from Reddit: ${JSON.stringify(json)}`);
  }

  const token = json.access_token;
  const expiresIn = json.expires_in || 3600;
  cachedToken = {
    token,
    expiryMs: Date.now() + expiresIn * 1000
  };
  return token;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-License-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const licenseKey = req.headers["x-license-key"];
  if (!licenseKey) {
    return res.status(401).json({ error: "License key required" });
  }

  try {
    const { q, limit = 25, sort = "relevance", time = "all", days = 60, samples = 8 } = req.body;
    
    if (!q || !q.trim()) {
      return res.status(400).json({ error: "Missing required parameter: q" });
    }

    const token = await getRedditAppToken();
    const userAgent = "RevenCast/1.0";

    // If caller supplied a short-hand time window like 'day','week','month', keep original behaviour.
    // Otherwise sample across last `days` days at `samples` random days and aggregate results.
    const daysWindow = Math.max(1, Math.min(days, 365));
    const sampleCount = Math.max(1, Math.min(samples, 30));
    const now = Date.now();
    const startWindowMs = now - daysWindow * 24 * 60 * 60 * 1000;

    // If client explicitly set time (day/week/month/etc), do single query
    if (req.body.time && ["hour","day","week","month","year","all"].includes(req.body.time)) {
      const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=${sort}&t=${time}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": userAgent,
          "Accept": "application/json"
        }
      });

      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // Sampling path
    const generated = new Set();
    const daysList = [];
    while (daysList.length < sampleCount) {
      const randMs = Math.floor(startWindowMs + Math.random() * (now - startWindowMs));
      const dayStart = new Date(randMs);
      const dayStr = dayStart.toISOString().slice(0,10);
      if (!generated.has(dayStr)) {
        generated.add(dayStr);
        daysList.push(dayStart);
      }
    }

    console.log(`Reddit sampling over last ${daysWindow} days with ${daysList.length} sample days`);

    const searchPromises = daysList.map(dayStart => {
      const startSec = Math.floor(new Date(dayStart.toISOString().slice(0,10) + 'T00:00:00Z').getTime() / 1000);
      const endSec = startSec + 24 * 60 * 60;
      const sampleQuery = `${q} timestamp:${startSec}..${endSec}`;
      const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(sampleQuery)}&limit=${limit}&sort=${sort}&syntax=cloudsearch`;
      console.log(`Reddit sample call: ${url}`);
      return fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": userAgent,
          "Accept": "application/json"
        }
      }).then(r => r.json()).catch(err => ({ error: err }));
    });

    const results = (await Promise.all(searchPromises)).filter(r => r && !r.error);

    // Combine and dedupe children
    const combined = [];
    const seen = new Set();
    for (const resData of results) {
      const children = resData?.data?.children || [];
      for (const c of children) {
        const id = c?.data?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          combined.push(c);
        }
      }
    }

    const aggregated = { data: { children: combined, dist: combined.length, after: null } };
    return res.status(200).json(aggregated);
    
  } catch (err) {
    console.error('Reddit API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
