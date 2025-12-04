import fetch from 'node-fetch';

let cachedToken = null; // { token, expiryMs }

async function getRedditAppToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.token && cachedToken.expiryMs && now < cachedToken.expiryMs - 60_000) {
    return cachedToken.token;
  }

  // HARDCODED client_id + user-agent
  const clientId = "YJ-wcP9Bz-uCK857l3xV2g";        // <-- hardcoded
  const userAgent = "RevenCast/1.0";               // <-- hardcoded

  // KEEP SECRET IN ENV (never hardcode secrets)
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

  const json = await res.json().catch(() => null);
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
    const { q, limit = 25, sort = "relevance", time = "all" } = req.body;
    
    const query = (q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "Missing required parameter: q" });
    }

    const token = await getRedditAppToken();
    const userAgent = "RevenCast/1.0";

    const url =
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}` +
      `&limit=${encodeURIComponent(limit)}` +
      `&sort=${encodeURIComponent(sort)}` +
      `&t=${encodeURIComponent(time)}`;

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
    
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}