// License key validation - ADD YOUR LICENSE KEYS HERE
const validLicenses = new Set([
  "revencast-license-001",
  "revencast-license-002", 
  "revencast-license-003"
  // Add all your customer license keys here
]);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const licenseKey = req.headers['x-license-key'];
  
  if (!licenseKey || !validLicenses.has(licenseKey)) {
    return res.status(401).json({ error: 'Invalid license key' });
  }

  return res.status(200).json({ valid: true, message: 'License valid' });
}