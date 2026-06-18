/**
 * Seed script: Migrate data from Realtime Database to Cloud Firestore.
 *
 * Usage: node scripts/seed-firestore.js
 *
 * Requires FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS env var.
 */

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
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS first.');
  process.exit(1);
}

const app = admin.initializeApp({
  credential: typeof sa === 'string'
    ? admin.credential.applicationDefault()
    : admin.credential.cert(sa),
});

const rtdb = app.database();
const db = app.firestore();

async function migrateNode(rtdbPath, firestoreCollection) {
  console.log(`\nMigrating /${rtdbPath} → ${firestoreCollection}...`);
  const snap = await rtdb.ref(rtdbPath).once('value');
  if (!snap.exists()) {
    console.log(`  No data found at /${rtdbPath}, skipping.`);
    return;
  }

  const data = snap.val();
  const entries = typeof data === 'object' && data !== null
    ? Object.entries(data)
    : [[null, data]];

  const batch = db.batch();
  let count = 0;

  for (const [key, value] of entries) {
    const docId = key || 'default';
    const docRef = db.collection(firestoreCollection).doc(docId);
    if (typeof value === 'object' && value !== null) {
      batch.set(docRef, { ...value, id: docId }, { merge: true });
    } else {
      batch.set(docRef, { value, id: docId }, { merge: true });
    }
    count++;
  }

  await batch.commit();
  console.log(`  ✅ ${count} documents migrated to ${firestoreCollection}.`);
}

async function main() {
  console.log('=== Firestore Seed: RTDB → Firestore Migration ===\n');

  // Mapping of RTDB paths to Firestore collections
  const migrations = [
    { rtdb: 'careerPaths',   firestore: 'careerPaths' },
    { rtdb: 'howItWorks',    firestore: 'howItWorks' },
    { rtdb: 'faqs',          firestore: 'faqs' },
    { rtdb: 'config/templates', firestore: 'config' },        // doc: templates
    { rtdb: 'config/aboutText',  firestore: 'config' },       // doc: aboutText
    { rtdb: 'siteSettings/earn', firestore: 'siteSettings' }, // doc: earn
    { rtdb: 'siteSettings/earnDetails', firestore: 'siteSettings' }, // doc: earnDetails
    { rtdb: 'admins',        firestore: 'admins' },
    { rtdb: 'bannedUsers',   firestore: 'bannedUsers' },
    { rtdb: 'adminMessages', firestore: 'adminMessages' },
    { rtdb: 'selfReferralOwners', firestore: 'selfReferralOwners' },
  ];

  for (const m of migrations) {
    await migrateNode(m.rtdb, m.firestore);
  }

  // Handle special cases
  console.log('\nMigrating special paths...');

  // templates → config/templates
  const templatesSnap = await rtdb.ref('config/templates').once('value');
  if (templatesSnap.exists()) {
    await db.collection('config').doc('templates').set(templatesSnap.val(), { merge: true });
    console.log('  ✅ templates → config/templates');
  }

  // aboutText → config/aboutText
  const aboutSnap = await rtdb.ref('config/aboutText').once('value');
  if (aboutSnap.exists()) {
    await db.collection('config').doc('aboutText').set({ text: aboutSnap.val() }, { merge: true });
    console.log('  ✅ aboutText → config/aboutText');
  }

  // earn settings
  const earnSnap = await rtdb.ref('siteSettings/earn').once('value');
  if (earnSnap.exists()) {
    await db.collection('siteSettings').doc('earn').set(earnSnap.val(), { merge: true });
    console.log('  ✅ earn → siteSettings/earn');
  }

  // earn details
  const earnDetailsSnap = await rtdb.ref('siteSettings/earnDetails').once('value');
  if (earnDetailsSnap.exists()) {
    await db.collection('siteSettings').doc('earnDetails').set(earnDetailsSnap.val(), { merge: true });
    console.log('  ✅ earnDetails → siteSettings/earnDetails');
  }

  // Migrate users
  console.log('\nMigrating users...');
  const usersSnap = await rtdb.ref('users').once('value');
  if (usersSnap.exists()) {
    const users = usersSnap.val();
    let count = 0;
    for (const [uid, data] of Object.entries(users)) {
      if (typeof data === 'object' && data !== null) {
        await db.collection('users').doc(uid).set(data, { merge: true });
        count++;
      }
    }
    console.log(`  ✅ ${count} users migrated.`);
  } else {
    console.log('  No users found.');
  }

  // Migrate enrollments
  console.log('\nMigrating enrollments...');
  const enrollSnap = await rtdb.ref('enrollments').once('value');
  if (enrollSnap.exists()) {
    const enrollments = enrollSnap.val();
    let count = 0;
    for (const [id, data] of Object.entries(enrollments)) {
      if (typeof data === 'object' && data !== null) {
        await db.collection('enrollments').doc(id).set({ ...data, id }, { merge: true });
        count++;
      }
    }
    console.log(`  ✅ ${count} enrollments migrated.`);
  } else {
    console.log('  No enrollments found.');
  }

  // Migrate referrals
  console.log('\nMigrating referrals...');
  const refSnap = await rtdb.ref('referrals').once('value');
  if (refSnap.exists()) {
    const referrals = refSnap.val();
    let count = 0;
    for (const [code, data] of Object.entries(referrals)) {
      if (typeof data === 'object' && data !== null) {
        await db.collection('referrals').doc(code).set(data, { merge: true });
        count++;
      }
    }
    console.log(`  ✅ ${count} referrals migrated.`);
  } else {
    console.log('  No referrals found.');
  }

  // Migrate referral visits
  console.log('\nMigrating referral visits...');
  const visitsSnap = await rtdb.ref('referralVisits').once('value');
  if (visitsSnap.exists()) {
    const visits = visitsSnap.val();
    let count = 0;
    for (const [id, data] of Object.entries(visits)) {
      if (typeof data === 'object' && data !== null) {
        await db.collection('referralVisits').doc(id).set(data, { merge: true });
        count++;
      }
    }
    console.log(`  ✅ ${count} referral visits migrated.`);
  } else {
    console.log('  No referral visits found.');
  }

  // Migrate referralUsers
  console.log('\nMigrating referralUsers...');
  const refUsersSnap = await rtdb.ref('referralUsers').once('value');
  if (refUsersSnap.exists()) {
    const refUsers = refUsersSnap.val();
    let count = 0;
    for (const [code, users] of Object.entries(refUsers)) {
      if (typeof users === 'object' && users !== null) {
        for (const [uid, data] of Object.entries(users)) {
          await db.collection('referralUsers').doc(code).collection('users').doc(uid).set(data, { merge: true });
          count++;
        }
      }
    }
    console.log(`  ✅ ${count} referral users migrated.`);
  } else {
    console.log('  No referral users found.');
  }

  console.log('\n=== Migration complete! ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
