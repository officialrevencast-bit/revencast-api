import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
let db;
try {
  if (process.env.FIRESTORE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIRESTORE_SERVICE_ACCOUNT);
    
    initializeApp({
      credential: cert(serviceAccount)
    });
    
    db = getFirestore();
    console.log('Firestore initialized successfully');
  }
} catch (error) {
  console.error('Firestore initialization failed:', error);
}

export default async function handler(req, res) {
  const internalSecret = process.env.INTERNAL_PROXY_SECRET;
  const incomingSecret = req.headers['x-internal-secret'];
  const licenseKey = req.headers['x-license-key'];
  const expectedLicense = process.env.REVENCAST_API_KEY;
  const hasInternalAuth = !!internalSecret && incomingSecret === internalSecret;
  const hasLegacyAuth = !!expectedLicense && licenseKey === expectedLicense;
  if (!hasInternalAuth && !hasLegacyAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key, X-Internal-Secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (!db) {
      return res.status(500).json({ 
        error: 'Firestore not initialized',
        details: 'FIRESTORE_SERVICE_ACCOUNT environment variable is not set or invalid'
      });
    }

    // Test connection
    const testRef = db.collection('test').doc('connection');
    
    await testRef.set({
      test: 'connection_test',
      timestamp: new Date().toISOString(),
      licenseKey: licenseKey
    }, { merge: true });

    const doc = await testRef.get();
    
    if (doc.exists) {
      return res.status(200).json({ 
        success: true, 
        message: 'Firestore connection successful',
        data: doc.data()
      });
    } else {
      return res.status(500).json({ error: 'Failed to read test document' });
    }

  } catch (error) {
    console.error('Firestore connection error:', error);
    return res.status(500).json({ 
      error: 'Firestore connection failed',
      details: error.message 
    });
  }
}
