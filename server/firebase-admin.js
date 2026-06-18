import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
    const app = initializeApp({
      credential: typeof sa === 'string' ? applicationDefault() : cert(sa),
    });
    db = getFirestore(app);
    adminAuth = getAuth(app);
  } catch (err) {
    console.error('Firebase Admin init failed:', err.message);
  }
}

export { db, adminAuth, FieldValue };
