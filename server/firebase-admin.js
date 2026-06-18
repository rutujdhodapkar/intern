import admin from 'firebase-admin';

function getServiceAccount() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    try {
      return JSON.parse(saJson);
    } catch {
      console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
    }
  }

  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) return saPath;

  return null;
}

const sa = getServiceAccount();

if (!sa) {
  console.warn(
    'Firebase Admin SDK not initialized. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.\n' +
    'Download a service account key from Firebase Console > Project Settings > Service Accounts > Generate new private key.'
  );
}

let db = null;
let adminAuth = null;

if (sa) {
  const app = admin.initializeApp({
    credential: typeof sa === 'string'
      ? admin.credential.applicationDefault()
      : admin.credential.cert(sa),
  });
  db = admin.firestore();
  adminAuth = app.auth();
}

export { db, adminAuth };
export default admin;
