import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import admin, { db, adminAuth } from './firebase-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    const content = await fs.readFile(envPath, 'utf-8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch {}
}

await loadEnvFile();

const INQUIRIES_FILE = path.join(__dirname, 'inquiries.json');
const REFERRALS_FILE = path.join(__dirname, 'referrals.json');
const VISITS_FILE = path.join(__dirname, 'referral-visits.json');
const ADMINS_FILE = path.join(__dirname, 'admins.json');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

async function readJson(filePath, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Firestore helpers ─────────────────────────────────────────────────────────
const firestoreAvailable = () => !!db;

async function getCollection(collection) {
  if (!firestoreAvailable()) return [];
  const snap = await db.collection(collection).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getDocument(collection, docId) {
  if (!firestoreAvailable()) return null;
  const snap = await db.collection(collection).doc(docId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function setDocument(collection, docId, data) {
  if (!firestoreAvailable()) return;
  await db.collection(collection).doc(docId).set(data, { merge: true });
}

async function deleteDocument(collection, docId) {
  if (!firestoreAvailable()) return;
  await db.collection(collection).doc(docId).delete();
}

// ─── Currency Rates ────────────────────────────────────────────────────────────
let cachedRates = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60;
const fallbackRates = {
  USD: 1.0, INR: 83.5, EUR: 0.93, GBP: 0.79,
  CAD: 1.37, AUD: 1.51, JPY: 157.4,
};

app.get('/api/rates', async (req, res) => {
  const now = Date.now();
  if (cachedRates && (now - lastFetchTime < CACHE_DURATION)) {
    return res.json({ success: true, rates: cachedRates, source: 'cache' });
  }
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    if (data && data.rates) {
      cachedRates = data.rates;
      lastFetchTime = now;
      return res.json({ success: true, rates: cachedRates, source: 'network' });
    }
  } catch (error) {
    console.error('Error fetching currency rates:', error.message);
  }
  return res.json({ success: true, rates: fallbackRates, source: 'fallback' });
});

// ─── Inquiries (legacy JSON-based) ─────────────────────────────────────────────
app.post('/api/inquire', async (req, res) => {
  const { name, email, phone, projectType, planTier } = req.body;
  if (!name || !email || !phone || !projectType || !planTier) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields.' });
  }
  const newInquiry = {
    id: `INQ-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...req.body,
    message: req.body.requirements || req.body.message || '',
    status: req.body.status || 'contacted',
    progress: req.body.progress || 'New request',
  };
  try {
    const inquiries = await readJson(INQUIRIES_FILE);
    inquiries.push(newInquiry);
    await writeJson(INQUIRIES_FILE, inquiries);
    console.log('\n--- NEW INQUIRY ---', newInquiry.name, newInquiry.email);
    return res.status(201).json({ success: true, message: 'Inquiry received!', inquiryId: newInquiry.id });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

app.get('/api/inquiries', async (req, res) => {
  const inquiries = await readJson(INQUIRIES_FILE);
  res.json({ success: true, data: inquiries });
});

// ─── Firestore-backed CRUD endpoints ──────────────────────────────────────────

// ─── Career Paths ───────────────────────────
app.get('/api/career-paths', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('careerPaths');
  res.json({ success: true, data: items });
});

app.put('/api/career-paths', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { paths } = req.body;
  const batch = db.batch();
  const existing = await db.collection('careerPaths').get();
  existing.forEach(d => batch.delete(d.ref));
  paths.forEach(p => {
    const id = p.id || crypto.randomBytes(16).toString('hex');
    batch.set(db.collection('careerPaths').doc(id), { ...p, id });
  });
  await batch.commit();
  res.json({ success: true });
});

// ─── How It Works ───────────────────────────
app.get('/api/how-it-works', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('howItWorks');
  items.sort((a, b) => (a.step || 0) - (b.step || 0));
  res.json({ success: true, data: items });
});

app.put('/api/how-it-works', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { steps } = req.body;
  const batch = db.batch();
  const existing = await db.collection('howItWorks').get();
  existing.forEach(d => batch.delete(d.ref));
  steps.forEach((s, idx) => {
    const id = s.id || `step_${idx + 1}`;
    batch.set(db.collection('howItWorks').doc(id), { ...s, id, step: Number(s.step) || idx + 1 });
  });
  await batch.commit();
  res.json({ success: true });
});

// ─── FAQs ───────────────────────────────────
app.get('/api/faqs', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('faqs');
  res.json({ success: true, data: items });
});

app.put('/api/faqs', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { faqs } = req.body;
  const batch = db.batch();
  const existing = await db.collection('faqs').get();
  existing.forEach(d => batch.delete(d.ref));
  faqs.forEach((f, idx) => {
    const id = f.id || `faq_${idx + 1}`;
    batch.set(db.collection('faqs').doc(id), { ...f, id });
  });
  await batch.commit();
  res.json({ success: true });
});

// ─── Templates ──────────────────────────────
app.get('/api/templates', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: {} });
  const doc = await getDocument('config', 'templates');
  res.json({ success: true, data: doc || {} });
});

app.put('/api/templates', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { templates } = req.body;
  await setDocument('config', 'templates', templates);
  res.json({ success: true });
});

// ─── About Text ─────────────────────────────
app.get('/api/about-text', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const doc = await getDocument('config', 'aboutText');
  res.json({ success: true, data: doc?.text || null });
});

app.put('/api/about-text', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { text } = req.body;
  await setDocument('config', 'aboutText', { text });
  res.json({ success: true });
});

// ─── User Profile ───────────────────────────
app.get('/api/users/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const doc = await getDocument('users', req.params.uid);
  res.json({ success: true, data: doc || null });
});

app.put('/api/users/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { profile } = req.body;
  await setDocument('users', req.params.uid, { ...profile, updatedAt: new Date().toISOString() });
  res.json({ success: true });
});

// ─── Enrollments ────────────────────────────
app.get('/api/enrollments', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const { uid } = req.query;
  let items = await getCollection('enrollments');
  if (uid) items = items.filter(e => e.uid === uid);
  res.json({ success: true, data: items });
});

app.get('/api/enrollments/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const doc = await getDocument('enrollments', req.params.id);
  res.json({ success: true, data: doc || null });
});

app.post('/api/enrollments', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const enrollment = {
    ...req.body,
    id: req.body.id || undefined,
    createdAt: req.body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const docRef = enrollment.id
    ? db.collection('enrollments').doc(enrollment.id)
    : db.collection('enrollments').doc();
  enrollment.id = docRef.id;
  await docRef.set(enrollment);

  if (enrollment.referralCode) {
    try {
      const refSnap = await db.collection('referrals').doc(enrollment.referralCode.toUpperCase()).get();
      if (refSnap.exists) {
        await refSnap.ref.update({
          selected: admin.firestore.FieldValue.increment(1),
          lastSelectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {}
  }
  res.status(201).json({ success: true, data: enrollment });
});

app.patch('/api/enrollments/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('enrollments', req.params.id, { ...req.body, updatedAt: new Date().toISOString() });
  res.json({ success: true });
});

app.delete('/api/enrollments/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await deleteDocument('enrollments', req.params.id);
  res.json({ success: true });
});

// ─── Project Submissions ────────────────────
app.post('/api/enrollments/:id/submissions/:projectIndex', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { id, projectIndex } = req.params;
  await db.collection('enrollments').doc(id).update({
    [`submissions.${projectIndex}`]: {
      ...req.body,
      submittedAt: req.body.submittedAt || new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  });
  res.json({ success: true });
});

// ─── Referrals ──────────────────────────────
app.get('/api/referrals', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const { code } = req.query;
  if (code) {
    const doc = await getDocument('referrals', code.toUpperCase());
    return res.json({ success: true, data: doc || null });
  }
  const items = await getCollection('referrals');
  res.json({ success: true, data: items });
});

app.post('/api/referrals', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const referral = {
    ...req.body,
    code: req.body.code || `REF-${Date.now().toString(36).toUpperCase()}`,
    createdAt: req.body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.collection('referrals').doc(referral.code).set(referral);
  res.status(201).json({ success: true, data: referral });
});

app.delete('/api/referrals/:code', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const code = req.params.code.toUpperCase();
  await deleteDocument('referrals', code);
  try { await deleteDocument('referralUsers', code); } catch {}
  res.json({ success: true });
});

app.post('/api/referrals/:code/contacted', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const code = req.params.code.toUpperCase();
  const ref = db.collection('referrals').doc(code);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({
      selected: admin.firestore.FieldValue.increment(1),
      lastSelectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  res.json({ success: true });
});

// ─── Referral Users ─────────────────────────
app.post('/api/referral-users', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { code, user: userData, isNew } = req.body;
  const codeUpper = String(code).toUpperCase();
  const docRef = db.collection('referralUsers').doc(codeUpper).collection('users').doc(userData.uid);
  const snap = await docRef.get();
  const payload = {
    ...userData,
    referralCode: codeUpper,
    lastLoginAt: new Date().toISOString(),
  };
  if (!snap.exists) {
    payload.firstLoginAt = new Date().toISOString();
  }
  await docRef.set(payload, { merge: true });

  if (isNew || !snap.exists) {
    try {
      await db.collection('referrals').doc(codeUpper).update({
        loggedIn: admin.firestore.FieldValue.increment(1),
        lastLoginAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch {}
  }
  res.json({ success: true });
});

// ─── Referral Visits ────────────────────────
app.post('/api/referral-visits', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const visit = {
    ...req.body,
    referralCode: String(req.body.referralCode || '').toUpperCase(),
    visitedAt: req.body.visitedAt || new Date().toISOString(),
  };
  const docRef = db.collection('referralVisits').doc();
  visit.id = docRef.id;
  visit.visitId = docRef.id;
  await docRef.set(visit);

  try {
    const refDoc = db.collection('referrals').doc(visit.referralCode);
    const snap = await refDoc.get();
    if (snap.exists) {
      await refDoc.update({
        visited: admin.firestore.FieldValue.increment(1),
        lastVisitedAt: visit.visitedAt,
        updatedAt: new Date().toISOString(),
      });
      await docRef.update({ matched: true });
      visit.matched = true;
    }
  } catch {}
  res.status(201).json({ success: true, data: visit });
});

// ─── Referral Dashboard ─────────────────────
app.get('/api/referral-dashboard/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const { uid } = req.params;

  const userDoc = await getDocument('users', uid);
  const code = userDoc?.selfReferralCode || null;
  if (!code) return res.json({ success: true, data: null });

  const codeUpper = code.toUpperCase();
  const referralDoc = await getDocument('referrals', codeUpper);
  const allEnrollments = await getCollection('enrollments');
  const allVisits = await getCollection('referralVisits');

  const relatedEnrollments = allEnrollments.filter(
    e => String(e.referralCode || '').toUpperCase() === codeUpper
  );
  const relatedVisits = allVisits.filter(
    v => String(v.referralCode || '').toUpperCase() === codeUpper
  );

  let loginUsers = [];
  try {
    const usersSnap = await db.collection('referralUsers').doc(codeUpper).collection('users').get();
    loginUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {}

  const completionInfo = (enrollment) => {
    const projects = Array.isArray(enrollment.projects) ? enrollment.projects : [];
    const submissions = enrollment.submissions || {};
    const verifiedCount = projects.filter((_, i) => submissions[i]?.verified).length;
    return { total: projects.length, verified: verifiedCount, completed: projects.length > 0 && verifiedCount === projects.length };
  };

  const completedInterns = relatedEnrollments.filter(e => completionInfo(e).completed);

  res.json({
    success: true,
    data: {
      code: codeUpper,
      referral: referralDoc || null,
      visits: relatedVisits.sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 50),
      totalVisits: relatedVisits.length,
      totalLogins: loginUsers.length,
      enrolledInterns: relatedEnrollments,
      totalEnrolled: relatedEnrollments.length,
      completedInterns: completedInterns.length,
      completedInternIds: completedInterns.map(e => e.internId || e.id),
    },
  });
});

// ─── Self-Referral ──────────────────────────
app.post('/api/self-referral', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { details, uid } = req.body;
  const prefix = details.name.replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const code = `${prefix}-${suffix}`;
  const payload = {
    ...details,
    code,
    createdBy: uid,
    isSelfReferral: true,
    visited: 0, selected: 0, loggedIn: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.collection('referrals').doc(code).set(payload);
  await setDocument('selfReferralOwners', uid, { code, createdAt: payload.createdAt });
  await db.collection('users').doc(uid).update({ selfReferralCode: code });
  res.status(201).json({ success: true, data: payload });
});

app.get('/api/self-referral-code/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const { uid } = req.params;
  let code = null;
  try {
    const doc = await getDocument('selfReferralOwners', uid);
    if (doc) code = doc.code;
  } catch {}
  if (!code) {
    try {
      const userDoc = await getDocument('users', uid);
      if (userDoc?.selfReferralCode) code = userDoc.selfReferralCode;
    } catch {}
  }
  res.json({ success: true, data: code });
});

// ─── Permanent Referral Code ────────────────
app.post('/api/permanent-referral-code', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { uid, code } = req.body;
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (snap.exists && !snap.data().permanentReferralCode) {
    await userRef.update({
      permanentReferralCode: code.toUpperCase(),
      permanentReferralDetectedAt: new Date().toISOString(),
    });
  }
  res.json({ success: true });
});

app.get('/api/permanent-referral-code/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const userDoc = await getDocument('users', req.params.uid);
  res.json({ success: true, data: userDoc?.permanentReferralCode || null });
});

// ─── Verify Internship ──────────────────────
app.get('/api/verify-internship/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  let doc = await getDocument('enrollments', req.params.id);
  if (!doc) {
    const all = await getCollection('enrollments');
    doc = all.find(e => e.internId === req.params.id) || null;
  }
  res.json({ success: true, data: doc });
});

// ─── Admin Management ──────────────────────
app.post('/api/check-admin', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  const cleanEmail = email.toLowerCase().trim();
  if (cleanEmail === 'rutujdhodapkar@gmail.com') return res.json({ success: true, isAdmin: true });

  if (firestoreAvailable()) {
    try {
      const snap = await db.collection('admins').doc(cleanEmail.replace(/\./g, ',')).get();
      return res.json({ success: true, isAdmin: snap.exists });
    } catch {}
  }
  const admins = await readJson(ADMINS_FILE);
  const isAdmin = admins.some(a => a.toLowerCase().trim() === cleanEmail);
  return res.json({ success: true, isAdmin });
});

app.get('/api/admins', async (req, res) => {
  if (firestoreAvailable()) {
    const items = await getCollection('admins');
    return res.json({ success: true, data: items.map(i => i.email) });
  }
  const admins = await readJson(ADMINS_FILE);
  return res.json({ success: true, data: admins });
});

app.post('/api/admins', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  const cleanEmail = email.toLowerCase().trim();
  if (firestoreAvailable()) {
    await setDocument('admins', cleanEmail.replace(/\./g, ','), { email: cleanEmail, addedAt: new Date().toISOString() });
    return res.json({ success: true });
  }
  const admins = await readJson(ADMINS_FILE);
  if (!admins.includes(cleanEmail)) { admins.push(cleanEmail); await writeJson(ADMINS_FILE, admins); }
  return res.json({ success: true });
});

app.delete('/api/admins/:email', async (req, res) => {
  const cleanEmail = req.params.email.toLowerCase().trim();
  if (firestoreAvailable()) {
    await deleteDocument('admins', cleanEmail.replace(/\./g, ','));
    return res.json({ success: true });
  }
  const admins = await readJson(ADMINS_FILE);
  const updated = admins.filter(a => a.toLowerCase().trim() !== cleanEmail);
  await writeJson(ADMINS_FILE, updated);
  return res.json({ success: true });
});

// ─── Banned Users ───────────────────────────
app.get('/api/banned-users', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('bannedUsers');
  res.json({ success: true, data: items });
});

app.get('/api/banned-users/check', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const { email } = req.query;
  if (!email) return res.json({ success: true, data: null });
  const key = email.toLowerCase().trim().replace(/\./g, ',');
  const doc = await getDocument('bannedUsers', key);
  res.json({ success: true, data: doc || null });
});

app.post('/api/banned-users', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { email, banType, reason, bannedBy } = req.body;
  const key = email.toLowerCase().trim().replace(/\./g, ',');
  await setDocument('bannedUsers', key, {
    email: email.toLowerCase().trim(),
    banType: banType || 'both',
    reason: reason || '',
    bannedAt: new Date().toISOString(),
    bannedBy: bannedBy || '',
  });
  res.json({ success: true });
});

app.delete('/api/banned-users/:email', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const key = req.params.email.toLowerCase().trim().replace(/\./g, ',');
  await deleteDocument('bannedUsers', key);
  res.json({ success: true });
});

// ─── Admin Messages ─────────────────────────
app.get('/api/admin-messages', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('adminMessages');
  const now = new Date();
  const { email } = req.query;
  const filtered = items.filter(msg => {
    if (msg.expiresAt && new Date(msg.expiresAt) < now) return false;
    if (msg.target === 'all') return true;
    if (email && msg.target && msg.target.toLowerCase() === email.toLowerCase()) return true;
    return false;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, data: filtered });
});

app.get('/api/all-admin-messages', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('adminMessages');
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, data: items });
});

app.post('/api/admin-messages', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const msgRef = db.collection('adminMessages').doc();
  await msgRef.set({ ...req.body, id: msgRef.id, createdAt: new Date().toISOString() });
  res.status(201).json({ success: true, data: { id: msgRef.id } });
});

app.delete('/api/admin-messages/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await deleteDocument('adminMessages', req.params.id);
  res.json({ success: true });
});

// ─── Site Settings ──────────────────────────
app.get('/api/site-settings/:key', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const doc = await getDocument('siteSettings', req.params.key);
  res.json({ success: true, data: doc || null });
});

app.put('/api/site-settings/:key', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('siteSettings', req.params.key, req.body);
  res.json({ success: true });
});

// ─── Admin Dashboard Data ───────────────────
app.get('/api/admin-data', async (req, res) => {
  if (firestoreAvailable()) {
    try {
      const [enrollments, referrals, visits, referralUsers] = await Promise.all([
        getCollection('enrollments'),
        getCollection('referrals'),
        getCollection('referralVisits'),
        db.collection('referralUsers').listDocuments().then(() => ({})) // just placeholder
      ]);

      const sortedRequests = [...enrollments].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const sortedVisits = [...visits].sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 200);

      // Fetch referral users for each code
      const referralUsersMap = {};
      for (const ref of referrals) {
        try {
          const snap = await db.collection('referralUsers').doc(ref.code).collection('users').get();
          referralUsersMap[ref.code] = {};
          snap.docs.forEach(d => { referralUsersMap[ref.code][d.id] = d.data(); });
        } catch {}
      }

      const enrichedReferrals = referrals.map(ref => {
        const code = String(ref.code || ref.id || '').toUpperCase();
        const loginUsers = Object.values(referralUsersMap[code] || {});
        const relatedEnrollments = enrollments.filter(
          e => String(e.referralCode || '').toUpperCase() === code
        );
        const completionInfo = (enrollment) => {
          const projects = Array.isArray(enrollment.projects) ? enrollment.projects : [];
          const submissions = enrollment.submissions || {};
          const verifiedCount = projects.filter((_, i) => submissions[i]?.verified).length;
          return {
            total: projects.length, verified: verifiedCount,
            completed: projects.length > 0 && verifiedCount === projects.length,
          };
        };
        const loginUidSet = new Set(loginUsers.map(u => u.uid).filter(Boolean));
        relatedEnrollments.forEach(e => { if (e.uid) loginUidSet.add(e.uid); });
        const completed = relatedEnrollments.filter(e => completionInfo(e).completed);
        const completedNotPaid = relatedEnrollments.filter(e => completionInfo(e).completed && e.allowedCertificate !== 'yes');
        const completedAndPaid = relatedEnrollments.filter(e => e.allowedCertificate === 'yes');

        return {
          ...ref, code, totalLogined: loginUidSet.size,
          visited: Number(ref.visited || 0),
          assignedInternships: relatedEnrollments.length,
          completedInterns: completed.length,
          completedInternIds: completed.map(e => e.internId || e.id),
          completedNotPaidInterns: completedNotPaid.length,
          completedNotPaidInternIds: completedNotPaid.map(e => e.internId || e.id),
          completedAndPaidInterns: completedAndPaid.length,
          completedAndPaidInternIds: completedAndPaid.map(e => e.internId || e.id),
          loggedInUsers: loginUsers,
          assignedInternIds: relatedEnrollments.map(e => e.internId || e.id),
        };
      }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const visitsData = sortedVisits.map(v => ({
        ...v, id: v.visitId || v.id,
        referralCode: v.referralCode || '-',
        device: v.device || 'Unknown',
        country: v.country || 'Unknown',
        city: v.city || 'Unknown',
        link: v.link || '-',
        matched: v.matched === true,
        visitedAt: v.visitedAt ? new Date(v.visitedAt).toLocaleString() : '-',
      }));

      return res.json({ success: true, data: { requests: sortedRequests, referrals: enrichedReferrals, visits: visitsData } });
    } catch (err) {
      console.error('Admin data error:', err);
    }
  }

  const [requests, referrals, visits] = await Promise.all([
    readJson(INQUIRIES_FILE),
    readJson(REFERRALS_FILE),
    readJson(VISITS_FILE),
  ]);
  const sortedRequests = [...requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const sortedVisits = [...visits].sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 100);
  res.json({ success: true, data: { requests: sortedRequests, referrals, visits: sortedVisits } });
});

// ─── Referral Check ─────────────────────────
app.get('/api/referral-check/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code) return res.json({ success: true, data: false });
  if (firestoreAvailable()) {
    const doc = await getDocument('referrals', code);
    return res.json({ success: true, data: !!doc });
  }
  const referrals = await readJson(REFERRALS_FILE);
  const found = referrals.some(item => String(item.code).toUpperCase() === code);
  res.json({ success: true, data: found });
});

// ─── Referral Users w/ Interns (Admin) ─────
app.get('/api/admin-referral-users', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const [referrals, allEnrollments] = await Promise.all([
    getCollection('referrals'),
    getCollection('enrollments'),
  ]);
  const result = referrals.map(ref => {
    const relatedEnrollments = allEnrollments.filter(
      e => String(e.referralCode || '').toUpperCase() === ref.code
    );
    return {
      code: ref.code, name: ref.name || '', email: ref.email || '',
      phone: ref.phone || '', city: ref.city || '', upiId: ref.upiId || '',
      lastActivityAt: ref.lastActivityAt || ref.updatedAt || ref.createdAt,
      createdAt: ref.createdAt,
      internCount: relatedEnrollments.length,
      internIds: relatedEnrollments.map(e => e.internId || e.id),
      interns: relatedEnrollments.map(e => ({
        id: e.id, internId: e.internId || e.id, name: e.name || '',
        email: e.email || '', status: e.status || 'Active',
        appliedAt: e.createdAt, completedAt: e.completedAt, paymentDate: e.paymentDate,
      })),
    };
  });
  res.json({ success: true, data: result });
});

// ─── User Referral Stat ─────────────────────
app.get('/api/user-referral-stat', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const { email } = req.query;
  if (!email) return res.json({ success: true, data: null });
  const emailLower = email.toLowerCase().trim();
  const referrals = await getCollection('referrals');
  const matched = referrals.find(r => String(r.email || '').toLowerCase().trim() === emailLower);
  if (!matched) return res.json({ success: true, data: null });
  const enrollments = await getCollection('enrollments');
  const related = enrollments.filter(e => String(e.referralCode || '').toUpperCase() === matched.code);
  const verifiedCount = related.filter(e => {
    const subs = e.submissions || {};
    const projects = Array.isArray(e.projects) ? e.projects : [];
    return projects.length > 0 && projects.every((_, i) => subs[i]?.verified);
  }).length;
  res.json({
    success: true,
    data: {
      code: matched.code, visited: Number(matched.visited || 0),
      assignedInternships: related.length, completedInterns: verifiedCount,
    },
  });
});

// ─── AI Task Verification ──────────────────────────────────────────────────────
app.post('/api/ai/verify-task', async (req, res) => {
  const { taskTitle, taskDescription, submissionText, submissionUrl, internName } = req.body;
  if (!taskTitle || !submissionText) {
    return res.status(400).json({ success: false, message: 'Task title and submission text are required.' });
  }
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'NVIDIA API key not configured on server.' });
  }
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta/llama-3.3-70b-instruct',
        messages: [
          {
            role: 'system',
            content: `You are an AI internship task verifier. Evaluate the student's project submission against the task requirements.

Respond ONLY with a valid JSON object (no markdown, no extra text):
{
  "verified": boolean,
  "confidence": number (0-100),
  "reason": "brief explanation of your decision",
  "message": "constructive feedback for the student; if rejected explain what is missing or wrong, if verified give positive confirmation"
}`
          },
          {
            role: 'user',
            content: `Task Title: ${taskTitle}
Task Description: ${taskDescription || 'No description provided'}
Student Name: ${internName || 'Unknown'}
Student's Submission: ${submissionText}
${submissionUrl ? `Submission URL: ${submissionUrl}` : ''}

Evaluate this submission and respond with JSON only.`
          }
        ],
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    if (!response.ok) throw new Error(`NVIDIA API error ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { verified: false, confidence: 0, reason: 'No JSON in response', message: 'AI verification failed.' };
    } catch {
      result = { verified: false, confidence: 0, reason: 'Parse error', message: 'AI verification failed.' };
    }
    return res.json({ success: true, data: { ...result, rawResponse: content } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'AI verification failed: ' + error.message });
  }
});

const isVercel = process.env.VERCEL;
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (db) {
      console.log('Firebase Admin SDK connected with Firestore');
    } else {
      console.log('Firebase Admin SDK not configured. Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.');
    }
  });
}

export default app;
