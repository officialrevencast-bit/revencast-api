export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate license
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  try {
    const { email, password, returnSecureToken = true, requestType } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'FIREBASE_WEB_API_KEY not configured' });
    }

    // Forgot password flow
    if (requestType === 'PASSWORD_RESET') {
      const resetResponse = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: 'PASSWORD_RESET',
            email
          })
        }
      );

      const resetData = await resetResponse.json();
      if (!resetResponse.ok) {
        return res.status(resetResponse.status).json({
          error: 'Firebase Password Reset error',
          details: resetData?.error?.message || 'Unable to send reset email'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Password reset email sent',
        email
      });
    }

    // Login flow
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Firebase Auth error',
        details: data?.error?.message || 'Authentication failed'
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Firebase Auth proxy error:', error);
    return res.status(500).json({
      error: 'Firebase Auth proxy failed',
      details: error.message
    });
  }
}
