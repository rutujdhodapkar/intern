import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, adminAuth, FieldValue } from './firebase-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INQUIRIES_FILE = path.join(__dirname, 'inquiries.json');
const REFERRALS_FILE = path.join(__dirname, 'referrals.json');
const VISITS_FILE = path.join(__dirname, 'referral-visits.json');
const ADMINS_FILE = path.join(__dirname, 'admins.json');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const isVercel = process.env.VERCEL;

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// ─── JWT Auth Middleware ─────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/verify-token', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ success: false, message: 'ID token required.' });

  try {
    let decoded;
    if (adminAuth) {
      decoded = await adminAuth.verifyIdToken(idToken);
    } else {
      const { OAuth2Client } = await import('google-auth-library');
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) throw new Error('Auth not configured.');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      decoded = ticket.getPayload();
    }

    const user = {
      uid: decoded.uid || decoded.sub,
      email: decoded.email || '',
      name: decoded.name || decoded.displayName || decoded.email?.split('@')[0] || 'User',
      photoURL: decoded.picture || decoded.photoURL || '',
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true, secure: !!isVercel, sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ success: true, user, token });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Token verification failed: ' + err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.json({ success: true, user: null });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, user });
  } catch {
    res.clearCookie('token');
    res.json({ success: true, user: null });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ─── Async File Helpers ──────────────────────────────────────────────────────
async function readJson(filePath, fallback = []) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf-8')); }
  catch { return fallback; }
}
async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Firestore helpers ───────────────────────────────────────────────────────
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

// ─── Public Routes ───────────────────────────────────────────────────────────

// Currency Rates
let cachedRates = null, lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60;
const fallbackRates = { USD: 1.0, INR: 83.5, EUR: 0.93, GBP: 0.79, CAD: 1.37, AUD: 1.51, JPY: 157.4 };
app.get('/api/rates', async (req, res) => {
  const now = Date.now();
  if (cachedRates && (now - lastFetchTime < CACHE_DURATION))
    return res.json({ success: true, rates: cachedRates, source: 'cache' });
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (response.ok) {
      const data = await response.json();
      if (data?.rates) { cachedRates = data.rates; lastFetchTime = now; return res.json({ success: true, rates: cachedRates, source: 'network' }); }
    }
  } catch {}
  res.json({ success: true, rates: fallbackRates, source: 'fallback' });
});

// Verify Internship (public)
app.get('/api/verify-internship/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  let doc = await getDocument('enrollments', req.params.id);
  if (!doc) {
    const all = await getCollection('enrollments');
    doc = all.find(e => e.internId === req.params.id) || null;
  }
  res.json({ success: true, data: doc });
});

// Referral check (public)
app.get('/api/referral-check/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code) return res.json({ success: true, data: false });
  if (firestoreAvailable()) {
    const doc = await getDocument('referrals', code);
    return res.json({ success: true, data: !!doc });
  }
  const referrals = await readJson(REFERRALS_FILE);
  res.json({ success: true, data: referrals.some(item => String(item.code).toUpperCase() === code) });
});

// Referral visits (public - needed for tracking)
app.post('/api/referral-visits', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const visit = { ...req.body, referralCode: String(req.body.referralCode || '').toUpperCase(), visitedAt: req.body.visitedAt || new Date().toISOString() };
  const docRef = db.collection('referralVisits').doc();
  visit.id = docRef.id; visit.visitId = docRef.id;
  await docRef.set(visit);
  try {
    const refDoc = db.collection('referrals').doc(visit.referralCode);
    const snap = await refDoc.get();
    if (snap.exists) {
      await refDoc.update({ visited: FieldValue.increment(1), lastVisitedAt: visit.visitedAt, updatedAt: new Date().toISOString() });
      await docRef.update({ matched: true }); visit.matched = true;
    }
  } catch {}
  res.status(201).json({ success: true, data: visit });
});

// Inquiries (legacy JSON)
app.post('/api/inquire', async (req, res) => {
  const { name, email, phone, projectType, planTier } = req.body;
  if (!name || !email || !phone || !projectType || !planTier)
    return res.status(400).json({ success: false, message: 'Please provide all required fields.' });
  const newInquiry = { id: `INQ-${Date.now()}`, createdAt: new Date().toISOString(), ...req.body, message: req.body.requirements || req.body.message || '', status: req.body.status || 'contacted', progress: req.body.progress || 'New request' };
  try { const inquiries = await readJson(INQUIRIES_FILE); inquiries.push(newInquiry); await writeJson(INQUIRIES_FILE, inquiries); return res.status(201).json({ success: true, message: 'Inquiry received!', inquiryId: newInquiry.id }); }
  catch (error) { return res.status(500).json({ success: false, message: 'Internal server error.' }); }
});
app.get('/api/inquiries', async (req, res) => { res.json({ success: true, data: await readJson(INQUIRIES_FILE) }); });

// ─── Google OAuth via Firebase Auth REST API ─────────────────────────────────
const FIREBASE_API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;

app.get('/api/auth/google', async (req, res) => {
  if (!FIREBASE_API_KEY) return res.status(503).json({ success: false, message: 'Firebase Auth not configured. Set FIREBASE_WEB_API_KEY env var.' });
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'google.com', continueUri: redirectUri }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    res.cookie('sessionId', data.sessionId, { httpOnly: true, secure: !!isVercel, sameSite: 'lax', maxAge: 600000 });
    res.redirect(data.authUri);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create auth URI: ' + err.message });
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(401).send('No authorization code provided.');
  if (!FIREBASE_API_KEY) return res.status(503).send('Firebase Auth not configured.');
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestUri: redirectUri, postBody: `code=${code}&providerId=google.com`, returnSecureToken: true }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const fbAuth = await resp.json();
    let uid = fbAuth.localId, email = fbAuth.email || '', name = fbAuth.displayName || '', photoURL = fbAuth.photoUrl || '';
    if (adminAuth && fbAuth.idToken) {
      try { const decoded = await adminAuth.verifyIdToken(fbAuth.idToken); uid = decoded.uid; email = decoded.email || email; name = decoded.name || decoded.displayName || name; photoURL = decoded.picture || decoded.photoURL || photoURL; } catch {}
    }
    if (!uid) { uid = email.replace(/[^a-zA-Z0-9]/g, '_') || 'user_' + Date.now(); }
    const user = { uid, email, name, photoURL };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: !!isVercel, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
  } catch (err) {
    res.status(500).send('Authentication failed: ' + err.message);
  }
});

// Protected data routes
app.use('/api/career-paths', authenticateToken);
app.use('/api/how-it-works', authenticateToken);
app.use('/api/faqs', authenticateToken);
app.use('/api/templates', authenticateToken);
app.use('/api/about-text', authenticateToken);
app.use('/api/users', authenticateToken);
app.use('/api/enrollments', authenticateToken);
app.use('/api/referrals', authenticateToken);
app.use('/api/referral-users', authenticateToken);
app.use('/api/referral-dashboard', authenticateToken);
app.use('/api/self-referral', authenticateToken);
app.use('/api/self-referral-code', authenticateToken);
app.use('/api/permanent-referral-code', authenticateToken);
app.use('/api/admins', authenticateToken);
app.use('/api/banned-users', authenticateToken);
app.use('/api/admin-messages', authenticateToken);
app.use('/api/admin-data', authenticateToken);
app.use('/api/admin-referral-users', authenticateToken);
app.use('/api/user-referral-stat', authenticateToken);
app.use('/api/site-settings', authenticateToken);
app.use('/api/ai', authenticateToken);

// ─── Career Paths ───────────────────────────────────
app.get('/api/career-paths', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  res.json({ success: true, data: await getCollection('careerPaths') });
});
app.put('/api/career-paths', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { paths } = req.body; const batch = db.batch();
  (await db.collection('careerPaths').get()).forEach(d => batch.delete(d.ref));
  paths.forEach(p => { const id = p.id || crypto.randomBytes(16).toString('hex'); batch.set(db.collection('careerPaths').doc(id), { ...p, id }); });
  await batch.commit(); res.json({ success: true });
});

// ─── How It Works ───────────────────────────────────
app.get('/api/how-it-works', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('howItWorks');
  items.sort((a, b) => (a.step || 0) - (b.step || 0));
  res.json({ success: true, data: items });
});
app.put('/api/how-it-works', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { steps } = req.body; const batch = db.batch();
  (await db.collection('howItWorks').get()).forEach(d => batch.delete(d.ref));
  steps.forEach((s, idx) => { const id = s.id || `step_${idx + 1}`; batch.set(db.collection('howItWorks').doc(id), { ...s, id, step: Number(s.step) || idx + 1 }); });
  await batch.commit(); res.json({ success: true });
});

// ─── FAQs ───────────────────────────────────────────
app.get('/api/faqs', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  res.json({ success: true, data: await getCollection('faqs') });
});
app.put('/api/faqs', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { faqs } = req.body; const batch = db.batch();
  (await db.collection('faqs').get()).forEach(d => batch.delete(d.ref));
  faqs.forEach((f, idx) => { const id = f.id || `faq_${idx + 1}`; batch.set(db.collection('faqs').doc(id), { ...f, id }); });
  await batch.commit(); res.json({ success: true });
});

// ─── Templates & About ─────────────────────────────
app.get('/api/templates', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: {} });
  res.json({ success: true, data: await getDocument('config', 'templates') || {} });
});
app.put('/api/templates', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('config', 'templates', req.body.templates); res.json({ success: true });
});
app.get('/api/about-text', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const doc = await getDocument('config', 'aboutText');
  res.json({ success: true, data: doc?.text || null });
});
app.put('/api/about-text', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('config', 'aboutText', { text: req.body.text }); res.json({ success: true });
});

// ─── Users ──────────────────────────────────────────
app.get('/api/users/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  res.json({ success: true, data: await getDocument('users', req.params.uid) || null });
});
app.put('/api/users/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('users', req.params.uid, { ...req.body.profile, updatedAt: new Date().toISOString() });
  res.json({ success: true });
});

// ─── Enrollments ────────────────────────────────────
app.get('/api/enrollments', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  let items = await getCollection('enrollments');
  if (req.query.uid) items = items.filter(e => e.uid === req.query.uid);
  res.json({ success: true, data: items });
});
app.get('/api/enrollments/:id', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  res.json({ success: true, data: await getDocument('enrollments', req.params.id) || null });
});
app.post('/api/enrollments', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const enrollment = { ...req.body, createdAt: req.body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
  const docRef = db.collection('enrollments').doc();
  enrollment.id = docRef.id;
  await docRef.set(enrollment);
  if (enrollment.referralCode) {
    try { const refSnap = await db.collection('referrals').doc(enrollment.referralCode.toUpperCase()).get(); if (refSnap.exists) { await refSnap.ref.update({ selected: FieldValue.increment(1), lastSelectedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); } } catch {}
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
  await deleteDocument('enrollments', req.params.id); res.json({ success: true });
});
app.post('/api/enrollments/:id/submissions/:projectIndex', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await db.collection('enrollments').doc(req.params.id).update({ [`submissions.${req.params.projectIndex}`]: { ...req.body, submittedAt: req.body.submittedAt || new Date().toISOString() }, updatedAt: new Date().toISOString() });
  res.json({ success: true });
});

// ─── Referrals ──────────────────────────────────────
app.get('/api/referrals', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  if (req.query.code) return res.json({ success: true, data: await getDocument('referrals', String(req.query.code).toUpperCase()) || null });
  res.json({ success: true, data: await getCollection('referrals') });
});
app.post('/api/referrals', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const referral = { ...req.body, code: req.body.code || `REF-${Date.now().toString(36).toUpperCase()}`, createdAt: req.body.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  const ref = db.collection('referrals').doc(req.params.code.toUpperCase());
  const snap = await ref.get();
  if (snap.exists) await ref.update({ selected: FieldValue.increment(1), lastSelectedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  res.json({ success: true });
});

// ─── Referral Users ─────────────────────────────────
app.post('/api/referral-users', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { code, user: userData, isNew } = req.body;
  const codeUpper = String(code).toUpperCase();
  const docRef = db.collection('referralUsers').doc(codeUpper).collection('users').doc(userData.uid);
  const snap = await docRef.get();
  const payload = { ...userData, referralCode: codeUpper, lastLoginAt: new Date().toISOString() };
  if (!snap.exists) payload.firstLoginAt = new Date().toISOString();
  await docRef.set(payload, { merge: true });
  if (isNew || !snap.exists) {
    try { await db.collection('referrals').doc(codeUpper).update({ loggedIn: FieldValue.increment(1), lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); } catch {}
  }
  res.json({ success: true });
});

// ─── Referral Dashboard ─────────────────────────────
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
  const relatedEnrollments = allEnrollments.filter(e => String(e.referralCode || '').toUpperCase() === codeUpper);
  const relatedVisits = allVisits.filter(v => String(v.referralCode || '').toUpperCase() === codeUpper);
  let loginUsers = [];
  try { const usersSnap = await db.collection('referralUsers').doc(codeUpper).collection('users').get(); loginUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() })); } catch {}
  const completionInfo = (enrollment) => { const projects = Array.isArray(enrollment.projects) ? enrollment.projects : []; const submissions = enrollment.submissions || {}; const verifiedCount = projects.filter((_, i) => submissions[i]?.verified).length; return { total: projects.length, verified: verifiedCount, completed: projects.length > 0 && verifiedCount === projects.length }; };
  const completedInterns = relatedEnrollments.filter(e => completionInfo(e).completed);
  res.json({ success: true, data: { code: codeUpper, referral: referralDoc || null, visits: relatedVisits.sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 50), totalVisits: relatedVisits.length, totalLogins: loginUsers.length, enrolledInterns: relatedEnrollments, totalEnrolled: relatedEnrollments.length, completedInterns: completedInterns.length, completedInternIds: completedInterns.map(e => e.internId || e.id) } });
});

// ─── Self-Referral ──────────────────────────────────
app.post('/api/self-referral', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { details, uid } = req.body;
  const prefix = details.name.replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase();
  const code = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const payload = { ...details, code, createdBy: uid, isSelfReferral: true, visited: 0, selected: 0, loggedIn: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await db.collection('referrals').doc(code).set(payload);
  await setDocument('selfReferralOwners', uid, { code, createdAt: payload.createdAt });
  await db.collection('users').doc(uid).update({ selfReferralCode: code });
  res.status(201).json({ success: true, data: payload });
});
app.get('/api/self-referral-code/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  let code = null;
  try { const doc = await getDocument('selfReferralOwners', req.params.uid); if (doc) code = doc.code; } catch {}
  if (!code) { try { const userDoc = await getDocument('users', req.params.uid); if (userDoc?.selfReferralCode) code = userDoc.selfReferralCode; } catch {} }
  res.json({ success: true, data: code });
});

// ─── Permanent Referral Code ────────────────────────
app.post('/api/permanent-referral-code', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { uid, code } = req.body;
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (snap.exists && !snap.data().permanentReferralCode) await userRef.update({ permanentReferralCode: String(code).toUpperCase(), permanentReferralDetectedAt: new Date().toISOString() });
  res.json({ success: true });
});
app.get('/api/permanent-referral-code/:uid', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const userDoc = await getDocument('users', req.params.uid);
  res.json({ success: true, data: userDoc?.permanentReferralCode || null });
});

// ─── Admin Management ───────────────────────────────
app.post('/api/check-admin', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  const cleanEmail = email.toLowerCase().trim();
  if (cleanEmail === 'rutujdhodapkar@gmail.com') return res.json({ success: true, isAdmin: true });
  if (firestoreAvailable()) { try { const snap = await db.collection('admins').doc(cleanEmail.replace(/\./g, ',')).get(); return res.json({ success: true, isAdmin: snap.exists }); } catch {} }
  const admins = await readJson(ADMINS_FILE);
  res.json({ success: true, isAdmin: admins.some(a => a.toLowerCase().trim() === cleanEmail) });
});
app.get('/api/admins', async (req, res) => {
  if (firestoreAvailable()) { const items = await getCollection('admins'); return res.json({ success: true, data: items.map(i => i.email) }); }
  res.json({ success: true, data: await readJson(ADMINS_FILE) });
});
app.post('/api/admins', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required.' });
  const cleanEmail = email.toLowerCase().trim();
  if (firestoreAvailable()) { await setDocument('admins', cleanEmail.replace(/\./g, ','), { email: cleanEmail, addedAt: new Date().toISOString() }); return res.json({ success: true }); }
  const admins = await readJson(ADMINS_FILE);
  if (!admins.includes(cleanEmail)) { admins.push(cleanEmail); await writeJson(ADMINS_FILE, admins); }
  res.json({ success: true });
});
app.delete('/api/admins/:email', async (req, res) => {
  const cleanEmail = req.params.email.toLowerCase().trim();
  if (firestoreAvailable()) { await deleteDocument('admins', cleanEmail.replace(/\./g, ',')); return res.json({ success: true }); }
  const admins = await readJson(ADMINS_FILE);
  await writeJson(ADMINS_FILE, admins.filter(a => a.toLowerCase().trim() !== cleanEmail));
  res.json({ success: true });
});

// ─── Banned Users ───────────────────────────────────
app.get('/api/banned-users', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  res.json({ success: true, data: await getCollection('bannedUsers') });
});
app.get('/api/banned-users/check', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  if (!req.query.email) return res.json({ success: true, data: null });
  const doc = await getDocument('bannedUsers', req.query.email.toLowerCase().trim().replace(/\./g, ','));
  res.json({ success: true, data: doc || null });
});
app.post('/api/banned-users', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  const { email, banType, reason, bannedBy } = req.body;
  await setDocument('bannedUsers', email.toLowerCase().trim().replace(/\./g, ','), { email: email.toLowerCase().trim(), banType: banType || 'both', reason: reason || '', bannedAt: new Date().toISOString(), bannedBy: bannedBy || '' });
  res.json({ success: true });
});
app.delete('/api/banned-users/:email', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await deleteDocument('bannedUsers', req.params.email.toLowerCase().trim().replace(/\./g, ','));
  res.json({ success: true });
});

// ─── Admin Messages ─────────────────────────────────
app.get('/api/admin-messages', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const items = await getCollection('adminMessages');
  const now = new Date();
  const { email } = req.query;
  const filtered = items.filter(msg => { if (msg.expiresAt && new Date(msg.expiresAt) < now) return false; if (msg.target === 'all') return true; if (email && msg.target?.toLowerCase() === email.toLowerCase()) return true; return false; }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  await deleteDocument('adminMessages', req.params.id); res.json({ success: true });
});

// ─── Site Settings ──────────────────────────────────
app.get('/api/site-settings/:key', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  res.json({ success: true, data: await getDocument('siteSettings', req.params.key) || null });
});
app.put('/api/site-settings/:key', async (req, res) => {
  if (!firestoreAvailable()) return res.status(503).json({ success: false, message: 'Firestore not available.' });
  await setDocument('siteSettings', req.params.key, req.body); res.json({ success: true });
});

// ─── Admin Dashboard Data ───────────────────────────
app.get('/api/admin-data', async (req, res) => {
  if (firestoreAvailable()) {
    try {
      const [enrollments, referrals, visits] = await Promise.all([getCollection('enrollments'), getCollection('referrals'), getCollection('referralVisits')]);
      const sortedRequests = [...enrollments].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const sortedVisits = [...visits].sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 200);
      const referralUsersMap = {};
      for (const ref of referrals) { try { const snap = await db.collection('referralUsers').doc(ref.code).collection('users').get(); referralUsersMap[ref.code] = {}; snap.docs.forEach(d => { referralUsersMap[ref.code][d.id] = d.data(); }); } catch {} }
      const enrichedReferrals = referrals.map(ref => {
        const code = String(ref.code || ref.id || '').toUpperCase();
        const loginUsers = Object.values(referralUsersMap[code] || {});
        const relatedEnrollments = enrollments.filter(e => String(e.referralCode || '').toUpperCase() === code);
        const ci = (enrollment) => { const p = Array.isArray(enrollment.projects) ? enrollment.projects : []; const s = enrollment.submissions || {}; const v = p.filter((_, i) => s[i]?.verified).length; return { total: p.length, verified: v, completed: p.length > 0 && v === p.length }; };
        const loginUidSet = new Set(loginUsers.map(u => u.uid).filter(Boolean));
        relatedEnrollments.forEach(e => { if (e.uid) loginUidSet.add(e.uid); });
        const completed = relatedEnrollments.filter(e => ci(e).completed);
        const completedNotPaid = relatedEnrollments.filter(e => ci(e).completed && e.allowedCertificate !== 'yes');
        const completedAndPaid = relatedEnrollments.filter(e => e.allowedCertificate === 'yes');
        return { ...ref, code, totalLogined: loginUidSet.size, visited: Number(ref.visited || 0), assignedInternships: relatedEnrollments.length, completedInterns: completed.length, completedInternIds: completed.map(e => e.internId || e.id), completedNotPaidInterns: completedNotPaid.length, completedNotPaidInternIds: completedNotPaid.map(e => e.internId || e.id), completedAndPaidInterns: completedAndPaid.length, completedAndPaidInternIds: completedAndPaid.map(e => e.internId || e.id), loggedInUsers: loginUsers, assignedInternIds: relatedEnrollments.map(e => e.internId || e.id) };
      }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const visitsData = sortedVisits.map(v => ({ ...v, id: v.visitId || v.id, referralCode: v.referralCode || '-', device: v.device || 'Unknown', country: v.country || 'Unknown', city: v.city || 'Unknown', link: v.link || '-', matched: v.matched === true, visitedAt: v.visitedAt ? new Date(v.visitedAt).toLocaleString() : '-' }));
      return res.json({ success: true, data: { requests: sortedRequests, referrals: enrichedReferrals, visits: visitsData } });
    } catch (err) { console.error('Admin data error:', err); }
  }
  const [requests, referrals, visits] = await Promise.all([readJson(INQUIRIES_FILE), readJson(REFERRALS_FILE), readJson(VISITS_FILE)]);
  res.json({ success: true, data: { requests: [...requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), referrals, visits: [...visits].sort((a, b) => new Date(b.visitedAt) - new Date(a.visitedAt)).slice(0, 100) } });
});

// ─── Admin Referral Users ──────────────────────────
app.get('/api/admin-referral-users', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: [] });
  const [referrals, allEnrollments] = await Promise.all([getCollection('referrals'), getCollection('enrollments')]);
  const result = referrals.map(ref => { const r = allEnrollments.filter(e => String(e.referralCode || '').toUpperCase() === ref.code); return { code: ref.code, name: ref.name || '', email: ref.email || '', phone: ref.phone || '', city: ref.city || '', upiId: ref.upiId || '', lastActivityAt: ref.lastActivityAt || ref.updatedAt || ref.createdAt, createdAt: ref.createdAt, internCount: r.length, internIds: r.map(e => e.internId || e.id), interns: r.map(e => ({ id: e.id, internId: e.internId || e.id, name: e.name || '', email: e.email || '', status: e.status || 'Active', appliedAt: e.createdAt, completedAt: e.completedAt, paymentDate: e.paymentDate })) }; });
  res.json({ success: true, data: result });
});

// ─── User Referral Stat ─────────────────────────────
app.get('/api/user-referral-stat', async (req, res) => {
  if (!firestoreAvailable()) return res.json({ success: true, data: null });
  const { email } = req.query;
  if (!email) return res.json({ success: true, data: null });
  const referrals = await getCollection('referrals');
  const matched = referrals.find(r => String(r.email || '').toLowerCase().trim() === email.toLowerCase().trim());
  if (!matched) return res.json({ success: true, data: null });
  const enrollments = await getCollection('enrollments');
  const related = enrollments.filter(e => String(e.referralCode || '').toUpperCase() === matched.code);
  const verifiedCount = related.filter(e => { const subs = e.submissions || {}; const projects = Array.isArray(e.projects) ? e.projects : []; return projects.length > 0 && projects.every((_, i) => subs[i]?.verified); }).length;
  res.json({ success: true, data: { code: matched.code, visited: Number(matched.visited || 0), assignedInternships: related.length, completedInterns: verifiedCount } });
});

// ─── AI Task Verification ──────────────────────────────────────────────────────
app.post('/api/ai/verify-task', async (req, res) => {
  const { taskTitle, taskDescription, submissionText, submissionUrl, internName } = req.body;
  if (!taskTitle || !submissionText) return res.status(400).json({ success: false, message: 'Task title and submission text are required.' });
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'NVIDIA API key not configured.' });
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', messages: [{ role: 'system', content: `You are an AI internship task verifier. Evaluate the student's project submission against the task requirements.\n\nRespond ONLY with a valid JSON object (no markdown, no extra text):\n{\n  "verified": boolean,\n  "confidence": number (0-100),\n  "reason": "brief explanation",\n  "message": "constructive feedback"\n}` }, { role: 'user', content: `Task Title: ${taskTitle}\nTask Description: ${taskDescription || ''}\nStudent: ${internName || 'Unknown'}\nSubmission: ${submissionText}\n${submissionUrl ? `URL: ${submissionUrl}` : ''}\n\nEvaluate and respond with JSON only.` }], temperature: 0.3, max_tokens: 600 }),
    });
    if (!response.ok) throw new Error(`NVIDIA error ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    let result;
    try { const m = content.match(/\{[\s\S]*\}/); result = m ? JSON.parse(m[0]) : { verified: false, confidence: 0, reason: 'Parse error', message: 'AI verification failed.' }; } catch { result = { verified: false, confidence: 0, reason: 'Parse error', message: 'AI verification failed.' }; }
    res.json({ success: true, data: { ...result, rawResponse: content } });
  } catch (error) { res.status(500).json({ success: false, message: 'AI verification failed: ' + error.message }); }
});

// ─── Listen (local only) ──────────────────────────────────────────────────────
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (db) console.log('Firebase Admin SDK connected with Firestore');
    else console.log('Firebase Admin SDK not configured.');
  });
}

export default app;
