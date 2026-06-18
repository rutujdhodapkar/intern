/**
 * Seed script: Migrate data from Realtime Database to Cloud Firestore.
 *
 * Usage: node scripts/seed-firestore.js
 *
 * Requires FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS env var.
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const app = initializeApp({
  credential: typeof sa === 'string' ? applicationDefault() : cert(sa),
});

const db = getFirestore(app);
const rtdbUrl = process.env.FIREBASE_RTDB_URL;

async function migrateNode(rtdbPath, firestoreCollection) {
  console.log(`  Skipping /${rtdbPath} (RTDB not available).`);
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

  console.log('\nNo data migrated (RTDB unavailable). Update this script with static seed data or configure FIREBASE_RTDB_URL.');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
