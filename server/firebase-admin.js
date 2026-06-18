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

let db = null;
let FieldValue = null;
let initPromise = null;

async function initFirebase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const sa = getServiceAccount();
    if (!sa) return;
    try {
      const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
      const { getFirestore, FieldValue: FV } = await import('firebase-admin/firestore');
      FieldValue = FV;
      const app = initializeApp({
        credential: typeof sa === 'string' ? applicationDefault() : cert(sa),
      });
      db = getFirestore(app);
    } catch (err) {
      console.error('Firebase Admin init failed:', err.message);
    }
  })();
  return initPromise;
}

export { db, FieldValue, initFirebase };