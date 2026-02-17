import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let firebaseAuthClient = null;

function getBearerToken(req) {
  const raw = req.headers.authorization || req.headers.Authorization || '';
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return '';
  return trimmed.slice(7).trim();
}

function getFirebaseAuthClient() {
  if (firebaseAuthClient) {
    return firebaseAuthClient;
  }

  const serviceAccountRaw = process.env.FIRESTORE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) {
    throw new Error('FIRESTORE_SERVICE_ACCOUNT is not configured');
  }

  const serviceAccount = JSON.parse(serviceAccountRaw);
  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }

  firebaseAuthClient = getAuth();
  return firebaseAuthClient;
}

export function setCors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-License-Key, X-Internal-Secret');
  res.setHeader('Access-Control-Allow-Methods', methods);
}

export async function authorizeRequest(req, res, options = {}) {
  const {
    allowInternalSecret = true,
    allowBearer = true,
    allowAnonymous = false
  } = options;

  const internalSecret = process.env.INTERNAL_PROXY_SECRET;
  const incomingSecret = req.headers['x-internal-secret'];
  if (allowInternalSecret && internalSecret && incomingSecret && incomingSecret === internalSecret) {
    return { ok: true, mode: 'internal', uid: '' };
  }

  if (allowBearer) {
    const token = getBearerToken(req);
    if (token) {
      try {
        const auth = getFirebaseAuthClient();
        const decoded = await auth.verifyIdToken(token);
        const uid = String(decoded.uid || decoded.user_id || decoded.sub || '').trim();
        if (!uid) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        return { ok: true, mode: 'bearer', uid };
      } catch (_err) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
  }

  if (allowAnonymous) {
    return { ok: true, mode: 'anonymous', uid: '' };
  }

  return res.status(401).json({ error: 'Unauthorized' });
}
