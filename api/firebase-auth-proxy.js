import { setCors } from './_auth-utils.js';

const DEBUG_LOGS = String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' || process.env.APP_DEBUG_LOGS === '1';

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { email, password, returnSecureToken = true, requestType, refreshToken } = req.body || {};

    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'FIREBASE_WEB_API_KEY not configured' });
    }

    // Refresh token flow
    if (requestType === 'REFRESH_TOKEN') {
      if (!refreshToken) {
        return res.status(400).json({ error: 'refreshToken is required' });
      }

      const refreshResponse = await fetch(
        `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
          }).toString()
        }
      );

      const refreshData = await refreshResponse.json();
      if (!refreshResponse.ok) {
        return res.status(refreshResponse.status).json({
          error: 'Firebase token refresh error',
          details: refreshData?.error?.message || 'Unable to refresh token'
        });
      }

      return res.status(200).json(refreshData);
    }

    // Forgot password flow
    if (requestType === 'PASSWORD_RESET') {
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
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

    // Send verification email flow
    if (requestType === 'SEND_VERIFICATION_EMAIL') {
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }
      
      const verifyResponse = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: 'VERIFY_EMAIL',
            email: email
          })
        }
      );
      
      const verifyData = await verifyResponse.json();
      if (!verifyResponse.ok) {
        return res.status(verifyResponse.status).json({
          error: 'Firebase Verification Email error',
          details: verifyData?.error?.message || 'Unable to send verification email'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Verification email sent',
        email: email
      });
    }

    // Login flow
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
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
    logError('Firebase Auth proxy error:', error);
    return res.status(500).json({
      error: 'Firebase Auth proxy failed',
      details: error.message
    });
  }
}
