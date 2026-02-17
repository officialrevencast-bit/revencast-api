import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { authorizeRequest, setCors } from './_auth-utils.js';

const DEBUG_LOGS = String(process.env.APP_DEBUG_LOGS || '').toLowerCase() === 'true' || process.env.APP_DEBUG_LOGS === '1';

function logDebug(...args) {
  if (DEBUG_LOGS) console.log(...args);
}

function logError(...args) {
  if (DEBUG_LOGS) console.error(...args);
}

let db;
try {
  if (process.env.FIRESTORE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIRESTORE_SERVICE_ACCOUNT);
    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
    logDebug('Firestore initialized successfully');
  }
} catch (error) {
  logError('Firestore initialization failed:', error);
}

function decodeSentinels(value) {
  if (Array.isArray(value)) {
    return value.map((item) => decodeSentinels(item));
  }
  if (value && typeof value === 'object') {
    const normalized = {};
    for (const [key, innerValue] of Object.entries(value)) {
      normalized[key] = decodeSentinels(innerValue);
    }
    return normalized;
  }
  if (value === '__SERVER_TIMESTAMP__') return FieldValue.serverTimestamp();
  if (value === '__INCREMENT_1__') return FieldValue.increment(1);
  return value;
}

function userSimulationsCollection(userId) {
  return db.collection('simulations').doc(userId).collection('user_simulations');
}

function enforceUserScope(authContext, userId, res) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return res.status(400).json({ error: 'user_id is required' });
  }
  if (authContext.mode === 'bearer' && normalizedUserId !== authContext.uid) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  const authContext = await authorizeRequest(req, res);
  if (!authContext || !authContext.ok) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!db) {
      return res.status(500).json({
        error: 'Firestore not initialized',
        details: 'FIRESTORE_SERVICE_ACCOUNT environment variable is not set or invalid'
      });
    }

    const { action } = req.body || {};
    if (!action) {
      return res.status(400).json({ error: 'Missing action' });
    }

    if (action === 'health_check') {
      return res.status(200).json({ success: true, message: 'Firestore connection successful' });
    }

    if (action === 'get_user') {
      const userId = String(req.body?.user_id || '').trim();
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;
      const doc = await db.collection('Users').doc(userId).get();
      return res.status(200).json({ exists: doc.exists, data: doc.exists ? doc.data() : {} });
    }

    if (action === 'update_user') {
      const userId = String(req.body?.user_id || '').trim();
      const updates = req.body?.updates;
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;
      if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'updates object is required' });
      await db.collection('Users').doc(userId).set(decodeSentinels(updates), { merge: true });
      return res.status(200).json({ success: true });
    }

    if (action === 'get_active_subscription') {
      const userId = String(req.body?.user_id || '').trim();
      const subscriptionId = String(req.body?.subscription_id || '').trim();
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;

      let subscription = {};
      if (subscriptionId) {
        const byId = await db.collection('Subscriptions').doc(subscriptionId).get();
        if (byId.exists) subscription = byId.data() || {};
      }

      if (!Object.keys(subscription).length) {
        const query = await db.collection('Subscriptions')
          .where('firebaseUid', '==', userId)
          .where('status', '==', 'active')
          .limit(1)
          .get();
        if (!query.empty) {
          subscription = query.docs[0].data() || {};
        }
      }

      return res.status(200).json({ subscription });
    }

    if (action === 'list_user_simulation_docs') {
      const userId = String(req.body?.user_id || '').trim();
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;

      const snapshot = await userSimulationsCollection(userId).get();
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
      return res.status(200).json({ docs });
    }

    if (action === 'get_simulation_doc') {
      const userId = String(req.body?.user_id || '').trim();
      const docId = String(req.body?.doc_id || '').trim();
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;
      if (!docId) return res.status(400).json({ error: 'user_id and doc_id are required' });

      const doc = await userSimulationsCollection(userId).doc(docId).get();
      return res.status(200).json({ exists: doc.exists, data: doc.exists ? doc.data() : {} });
    }

    if (action === 'set_simulation_doc') {
      const userId = String(req.body?.user_id || '').trim();
      const docId = String(req.body?.doc_id || '').trim();
      const merge = Boolean(req.body?.merge);
      const data = req.body?.data;
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;
      if (!docId) return res.status(400).json({ error: 'user_id and doc_id are required' });
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data object is required' });

      await userSimulationsCollection(userId).doc(docId).set(decodeSentinels(data), { merge });
      return res.status(200).json({ success: true });
    }

    if (action === 'set_simulation_docs_batch') {
      const userId = String(req.body?.user_id || '').trim();
      const docs = Array.isArray(req.body?.docs) ? req.body.docs : null;
      const scopeError = enforceUserScope(authContext, userId, res);
      if (scopeError) return scopeError;
      if (!docs || docs.length === 0) return res.status(400).json({ error: 'docs array is required' });

      const batch = db.batch();
      for (const item of docs) {
        const docId = String(item?.doc_id || '').trim();
        const docData = item?.data;
        const merge = Boolean(item?.merge);
        if (!docId || !docData || typeof docData !== 'object') {
          return res.status(400).json({ error: 'Each docs item must include doc_id and data object' });
        }
        const ref = userSimulationsCollection(userId).doc(docId);
        batch.set(ref, decodeSentinels(docData), { merge });
      }
      await batch.commit();
      return res.status(200).json({ success: true, count: docs.length });
    }

    return res.status(400).json({ error: 'Unsupported action' });
  } catch (error) {
    logError('Firestore proxy error:', error);
    return res.status(500).json({
      error: 'Firestore proxy failed',
      details: error.message
    });
  }
}
