import admin from 'firebase-admin';

function getServiceAccount() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    try { return JSON.parse(saJson); }
    catch { console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.'); }
  }
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) return saPath;
  return null;
}

const sa = getServiceAccount();

let db = null;
let adminAuth = null;

if (sa) {
  try {
    const app = admin.initializeApp({
      credential: typeof sa === 'string'
        ? admin.credential.applicationDefault()
        : admin.credential.cert(sa),
    });
    db = admin.firestore();
    adminAuth = app.auth();
  } catch (err) {
    console.error('Firebase Admin init failed:', err.message);
  }
}

export { db, adminAuth };
export default admin;
