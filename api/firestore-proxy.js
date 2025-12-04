const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIRESTORE_SERVICE_ACCOUNT);
  
  initializeApp({
    credential: cert(serviceAccount)
  });
  
  db = getFirestore();
  console.log('Firestore initialized successfully');
} catch (error) {
  console.error('Firestore initialization failed:', error);
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate license
  const licenseKey = req.headers['x-license-key'];
  if (!licenseKey) {
    return res.status(401).json({ error: 'License key required' });
  }

  try {
    // Check if Firestore is initialized
    if (!db) {
      throw new Error('Firestore not initialized. Check FIRESTORE_SERVICE_ACCOUNT environment variable.');
    }

    // Simple connection test - try to get server timestamp
    const testRef = db.collection('test').doc('connection');
    
    await testRef.set({
      test: 'connection_test',
      timestamp: new Date().toISOString(),
      licenseKey: licenseKey
    }, { merge: true });

    // Read it back to verify
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
};