const API_BASE = import.meta.env.VITE_SERVER_URL || "";

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  if (!text || !text.trim()) {
    throw new Error("Server returned an empty response. Make sure the server is running.");
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error("Server returned invalid JSON: " + text.slice(0, 150));
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

// ─── Auth Functions (server-side, no Firebase SDK) ──────────────────────────
let cachedUser = null;
let authListeners = [];

export function loginWithGoogle() {
  window.location.href = `${API_BASE}/api/auth/google`;
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  cachedUser = null;
  authListeners.forEach(fn => fn(null));
}

export async function fetchCurrentUser() {
  try {
    const res = await apiFetch("/api/auth/me");
    cachedUser = res.user || null;
    return cachedUser;
  } catch {
    cachedUser = null;
    return null;
  }
}

export async function getCurrentUser() {
  if (cachedUser) return cachedUser;
  return await fetchCurrentUser();
}

export function onAuthChange(callback) {
  authListeners.push(callback);
  return () => { authListeners = authListeners.filter(fn => fn !== callback); };
}

export function notifyAuthChange(user) {
  cachedUser = user;
  authListeners.forEach(fn => fn(user));
}

// Verify a Firebase ID token (used if client has Firebase SDK, otherwise OAuth redirect)
export async function verifyIdToken(idToken) {
  const res = await apiFetch("/api/auth/verify-token", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
  cachedUser = res.user;
  authListeners.forEach(fn => fn(res.user));
  return res.user;
}

function snapToArray(val) {
  if (!val) return [];
  return Object.entries(val).map(([id, data]) => ({ id, ...data }));
}

function generateInternId(uid = "") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const source = String(uid || "anonymous-user");
  let hashA = 2166136261;
  let hashB = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 1597334677);
  }
  let value = (BigInt(hashA >>> 0) << 32n) | BigInt(hashB >>> 0);
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Number(value % BigInt(chars.length))];
    value /= BigInt(chars.length);
  }
  return `dev-craft-${result}`;
}

const DEFAULT_CAREER_PATHS = [
  { id: "path_python", title: "Python Development", duration: "4 Weeks", description: "Gain hands-on software development experience with Python scripting, data structures, and backends.", features: ["Basic Python syntax & scripting", "OOP & Data structures", "Flask & Django web development", "Final capstone project"], projects: ["Personal Portfolio Website", "Weather Web App", "Task Manager API"] },
  { id: "path_java", title: "Java Development", duration: "4 Weeks", description: "Build enterprise-ready applications using Java Core, Spring Boot microservices, and databases.", features: ["Java Core & JVM concepts", "OOP & Interface Design", "Spring Boot microservices", "Database integration & SQL"], projects: ["Library Management System", "REST API Backend", "Student Registry Platform"] },
  { id: "path_web", title: "Web Development", duration: "4 Weeks", description: "Learn to design and deploy modern, responsive frontend user interfaces using React.js and CSS.", features: ["HTML5 & CSS3 layout systems", "JavaScript ES6+ fundamentals", "React.js frontend frameworks", "State management & deployment"], projects: ["Responsive Portfolio", "Interactive Quiz App", "Admin Dashboard UI"] },
];

const DEFAULT_HOW_IT_WORKS = [
  { id: "step_1", step: 1, title: "Select Domain", description: "Browse our available career paths and select your preferred domain." },
  { id: "step_2", step: 2, title: "Instant Offer Letter", description: "Log in with Google, fill in your profile, and receive your official offer letter instantly." },
  { id: "step_3", step: 3, title: "Complete Projects", description: "Work through structured real-world tasks and submit them." },
  { id: "step_4", step: 4, title: "Get Certified", description: "Once verified, download your industry-ready internship completion certificate." },
];

const DEFAULT_FAQS = [
  { id: "faq_1", question: "Are the internships really 100% free?", answer: "Yes, all our virtual internships are 100% free of cost. There are no hidden fees or charges for learning and certification." },
  { id: "faq_2", question: "Who is eligible to apply?", answer: "Any college student or self-taught learner looking to gain practical software development and coding experience is welcome to apply." },
  { id: "faq_3", question: "How will my internship progress be tracked?", answer: "You will work on self-paced projects. Once you complete the projects, you submit them through the student area, and the team will verify your completion." },
  { id: "faq_4", question: "Is the certificate verified?", answer: "Yes, every certificate has a unique ID and can be verified publicly on our website through the verify button." },
];

const DEFAULT_OFFER_LETTER_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111; margin: 45px; line-height: 1.6; }
  .logo { font-size: 28px; font-weight: bold; letter-spacing: 2px; color: #000; margin-bottom: 20px; }
  .title { font-size: 22px; font-weight: bold; text-align: center; margin-bottom: 40px; text-transform: uppercase; }
  .content { font-size: 14px; margin-bottom: 30px; }
  .date { margin-bottom: 20px; }
  .signature-section { margin-top: 60px; }
  .signature { border-top: 1px solid #111; width: 200px; padding-top: 5px; font-size: 12px; }
  .footer { margin-top: 80px; text-align: center; font-size: 11px; color: #666; border-top: 1px solid #eee; padding-top: 10px; }
</style>
</head>
<body>
  <div class="logo">DevCraft</div>
  <div class="date">Date: {{date}}</div>
  <div class="title">Letter of Internship Offer</div>
  <div class="content">
    <p>Dear <strong>{{name}}</strong>,</p>
    <p>We are pleased to offer you a virtual internship in the domain of <strong>{{domain}}</strong> at DevCraft. Your internship is scheduled to begin on <strong>{{date}}</strong> for a duration of <strong>4 Weeks</strong>.</p>
    <p>During this program, you will gain hands-on experience in software development by working on real-world projects and solving technical challenges. You will be expected to complete all assigned projects and submit them for review before the program's completion date.</p>
    <p>Upon successful completion and evaluation of your projects, you will be awarded an official Internship Completion Certificate from DevCraft.</p>
    <p>We look forward to working with you. If you accept this offer, please proceed with your virtual onboarding.</p>
    <p>Best regards,</p>
  </div>
  <div class="signature-section">
    <div class="signature"><strong>DevCraft Team</strong><br>Program Coordinator</div>
  </div>
  <div class="footer">DevCraft © 2026. This is an automatically generated document. Verification ID: {{id}} | Intern ID: {{internId}}</div>
</body>
</html>`;

const DEFAULT_CERTIFICATE_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Georgia', serif; color: #1a1a1a; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; background-color: #fcfcfc; }
  .cert-container { border: 15px double #bda068; padding: 40px; width: 750px; background-color: #fff; text-align: center; margin: 30px; }
  .header { font-size: 26px; font-weight: bold; letter-spacing: 3px; color: #bda068; margin-bottom: 20px; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .subtitle { font-size: 14px; font-style: italic; color: #666; margin-bottom: 30px; }
  .presented-to { font-size: 13px; text-transform: uppercase; color: #888; margin-bottom: 10px; letter-spacing: 2px; }
  .student-name { font-size: 32px; font-weight: bold; color: #111; margin-bottom: 25px; border-bottom: 2px solid #eee; display: inline-block; padding-bottom: 5px; }
  .cert-text { font-size: 15px; line-height: 1.8; color: #444; margin: 20px 50px; }
  .domain-highlight { font-weight: bold; color: #bda068; }
  .meta-row { display: flex; justify-content: space-between; margin-top: 50px; font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; }
  .meta-col { text-align: center; width: 150px; }
  .sig-line { border-top: 1px solid #aaa; margin-bottom: 5px; padding-top: 5px; font-weight: bold; }
  .footer { margin-top: 40px; font-size: 11px; color: #999; font-family: 'Helvetica Neue', Arial, sans-serif; }
</style>
</head>
<body>
  <div class="cert-container">
    <div class="header">CERTIFICATE OF COMPLETION</div>
    <div class="subtitle">DEVCRAFT VIRTUAL INTERNSHIP PROGRAM</div>
    <div class="presented-to">This is proudly presented to</div>
    <div class="student-name">{{name}}</div>
    <div class="cert-text">for successfully completing the 4-week virtual internship in <span class="domain-highlight">{{domain}}</span>. During this tenure, the candidate demonstrated outstanding commitment, built industry-grade projects, and met all program criteria.</div>
    <div class="meta-row">
      <div class="meta-col"><div class="sig-line">Date of Issue</div><div>{{date}}</div></div>
      <div class="meta-col"><div style="height:30px;line-height:30px;font-size:16px;font-family:'Georgia',serif;font-style:italic;color:#bda068;">DevCraft</div><div class="sig-line">Authorized Signatory</div></div>
      <div class="meta-col"><div class="sig-line">Intern ID</div><div>{{internId}}</div></div>
    </div>
    <div class="footer">DevCraft © 2026. Credential ID: {{id}} | Verify at devcraft.internship</div>
  </div>
</body>
</html>`;

export { DEFAULT_CAREER_PATHS, DEFAULT_HOW_IT_WORKS, DEFAULT_FAQS };

// ─── Career Paths ────────────────────────────────────
export async function fetchCareerPaths() {
  try {
    const res = await apiFetch("/api/career-paths");
    if (res.data && res.data.length > 0) return res.data;
  } catch {}
  return DEFAULT_CAREER_PATHS;
}

export async function saveCareerPaths(paths) {
  await apiFetch("/api/career-paths", {
    method: "PUT",
    body: JSON.stringify({ paths }),
  });
}

// ─── How It Works ────────────────────────────────────
export async function fetchHowItWorks() {
  try {
    const res = await apiFetch("/api/how-it-works");
    if (res.data && res.data.length > 0) return res.data.sort((a, b) => (a.step || 0) - (b.step || 0));
  } catch {}
  return DEFAULT_HOW_IT_WORKS;
}

export async function saveHowItWorks(steps) {
  await apiFetch("/api/how-it-works", {
    method: "PUT",
    body: JSON.stringify({ steps }),
  });
}

// ─── FAQs ────────────────────────────────────────────
export async function fetchFAQs() {
  try {
    const res = await apiFetch("/api/faqs");
    if (res.data && res.data.length > 0) return res.data;
  } catch {}
  return DEFAULT_FAQS;
}

export async function saveFAQs(faqs) {
  await apiFetch("/api/faqs", {
    method: "PUT",
    body: JSON.stringify({ faqs }),
  });
}

// ─── Templates ───────────────────────────────────────
export async function fetchTemplates() {
  try {
    const res = await apiFetch("/api/templates");
    if (res.data) {
      return {
        offer_letter: res.data.offer_letter || DEFAULT_OFFER_LETTER_TEMPLATE,
        certificate: res.data.certificate || DEFAULT_CERTIFICATE_TEMPLATE,
      };
    }
  } catch {}
  return { offer_letter: DEFAULT_OFFER_LETTER_TEMPLATE, certificate: DEFAULT_CERTIFICATE_TEMPLATE };
}

export async function saveTemplates(templates) {
  await apiFetch("/api/templates", {
    method: "PUT",
    body: JSON.stringify({ templates }),
  });
}

// ─── About Text ──────────────────────────────────────
export async function fetchAboutText() {
  try {
    const res = await apiFetch("/api/about-text");
    return res.data || "DevCraft provides top-tier 100% free virtual internships...";
  } catch {
    return "DevCraft provides top-tier 100% free virtual internships for university and college students. Gain verified work experience, finish structured programming projects, and receive certified validation for your software engineering credentials.";
  }
}

export async function saveAboutText(text) {
  await apiFetch("/api/about-text", {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
}

// ─── User Profile ────────────────────────────────────
export async function fetchUserProfile(uid) {
  try {
    const res = await apiFetch(`/api/users/${uid}`);
    return res.data || null;
  } catch { return null; }
}

export async function saveUserProfile(uid, profile) {
  await apiFetch(`/api/users/${uid}`, {
    method: "PUT",
    body: JSON.stringify({ profile }),
  });
}

// ─── Enrollments ─────────────────────────────────────
export async function enrollStudent(uid, profile, domainObj) {
  const existing = await fetchUserEnrollments(uid);
  const duplicate = existing.find(e => e.domainId === domainObj.id || (e.domain || "").toLowerCase() === (domainObj.title || "").toLowerCase());
  if (duplicate) return duplicate;

  let refCode = localStorage.getItem("detected_referral_code") || "";
  if (refCode) localStorage.removeItem("detected_referral_code");
  if (!refCode) {
    try {
      const permanentCode = await fetchPermanentReferralCode(uid);
      if (permanentCode) refCode = permanentCode;
    } catch {}
  }

  const internId = generateInternId(uid);
  const enrollment = {
    internId, uid,
    name: profile.name || profile.displayName || "",
    email: profile.email || "",
    phone: profile.phone || "",
    college: profile.college || "",
    city: profile.city || "",
    country: profile.country || "",
    domainId: domainObj.id,
    domain: domainObj.title,
    duration: domainObj.duration || "4 Weeks",
    projects: domainObj.projects || [],
    status: "Active",
    submissions: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    referralCode: refCode,
  };

  const res = await apiFetch("/api/enrollments", {
    method: "POST",
    body: JSON.stringify(enrollment),
  });
  return res.data;
}

export async function fetchEnrollments() {
  try {
    const res = await apiFetch("/api/enrollments");
    return res.data || [];
  } catch { return []; }
}

export async function fetchUserEnrollments(uid) {
  try {
    const res = await apiFetch(`/api/enrollments?uid=${encodeURIComponent(uid)}`);
    const all = res.data || [];
    const stableInternId = generateInternId(uid);
    const needsUpdate = all.filter(e => e.internId !== stableInternId);
    await Promise.all(needsUpdate.map(e =>
      apiFetch(`/api/enrollments/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({ internId: stableInternId }),
      }).catch(() => null)
    ));
    return all.map(e => ({ ...e, internId: stableInternId }));
  } catch { return []; }
}

export async function updateEnrollmentStatus(enrollmentId, status) {
  await apiFetch(`/api/enrollments/${enrollmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function submitTransactionId(enrollmentId, transactionId) {
  await apiFetch(`/api/enrollments/${enrollmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ transactionId }),
  });
}

export async function allowCertificate(enrollmentId, allowed) {
  await apiFetch(`/api/enrollments/${enrollmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ allowedCertificate: allowed }),
  });
}

export async function verifyInternship(enrollmentId) {
  try {
    const res = await apiFetch(`/api/verify-internship/${encodeURIComponent(enrollmentId)}`);
    return res.data || null;
  } catch {
    try {
      const all = await fetchEnrollments();
      return all.find(e => e.internId === enrollmentId) || null;
    } catch { return null; }
  }
}

// ─── Project Submissions ─────────────────────────────
export async function submitProject(enrollmentId, projectIndex, submissionText) {
  await apiFetch(`/api/enrollments/${enrollmentId}/submissions/${projectIndex}`, {
    method: "POST",
    body: JSON.stringify({
      text: submissionText,
      submittedAt: new Date().toISOString(),
      verified: false,
      verifiedAt: null,
      resubmit: false,
    }),
  });
}

export async function verifyProject(enrollmentId, projectIndex) {
  await apiFetch(`/api/enrollments/${enrollmentId}/submissions/${projectIndex}`, {
    method: "POST",
    body: JSON.stringify({ verified: true, verifiedAt: new Date().toISOString() }),
  });
}

export async function saveProjectFeedback(enrollmentId, projectIndex, feedback) {
  await apiFetch(`/api/enrollments/${enrollmentId}/submissions/${projectIndex}`, {
    method: "POST",
    body: JSON.stringify({ feedback, feedbackAt: new Date().toISOString() }),
  });
}

export async function rejectProject(enrollmentId, projectIndex, feedback) {
  await apiFetch(`/api/enrollments/${enrollmentId}/submissions/${projectIndex}`, {
    method: "POST",
    body: JSON.stringify({
      verified: false, resubmit: true, feedback,
      rejectedAt: new Date().toISOString(), submittedAt: null,
    }),
  });
}

export async function fetchEnrollmentById(enrollmentId) {
  try {
    const res = await apiFetch(`/api/enrollments/${enrollmentId}`);
    return res.data || null;
  } catch { return null; }
}

// ─── Admin Dashboard Data ────────────────────────────
export async function fetchAdminData() {
  try {
    const res = await apiFetch("/api/admin-data");
    const visits = (res.data.visits || []).map(v => ({
      ...v, matched: v.matched === true,
      visitedAt: v.visitedAt ? new Date(v.visitedAt).toLocaleString() : "-",
    }));
    return { requests: res.data.requests || [], referrals: res.data.referrals || [], visits };
  } catch {
    return { requests: [], referrals: [], visits: [] };
  }
}

// ─── Referral Check ─────────────────────────────────
export async function isReferralCodeMatched(referralCode) {
  const code = String(referralCode || "").trim().toUpperCase();
  if (!code) return false;
  try {
    const res = await apiFetch(`/api/referral-check/${encodeURIComponent(code)}`);
    return !!res.data;
  } catch { return false; }
}

// ─── Payments ────────────────────────────────────
export const PAYMENT_QR_DEFAULT = "https://raw.githubusercontent.com/rutujdhodapkar/Image-Hosting/main/GooglePay_QR.png";
export const PAYMENT_QR_REFERRAL = "https://raw.githubusercontent.com/rutujdhodapkar/Image-Hosting/main/GooglePay_QR(1).png";

// ─── Referral / Enrollment Deletion ──────────────────
export async function deleteReferral(code) {
  if (!code) throw new Error("Referral code is required.");
  const normalizedCode = code.toUpperCase();
  await apiFetch(`/api/referrals/${encodeURIComponent(normalizedCode)}`, { method: "DELETE" });
}

export async function deleteEnrollment(enrollmentId) {
  if (!enrollmentId) throw new Error("Enrollment ID is required.");
  await apiFetch(`/api/enrollments/${encodeURIComponent(enrollmentId)}`, { method: "DELETE" });
}

export async function createReferral(details) {
  const code = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const payload = {
    ...details, code,
    visited: 0, selected: 0, loggedIn: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const res = await apiFetch("/api/referrals", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

// ─── Referral Visit Tracking ────────────────────────
export async function trackReferralVisit(referralCode) {
  if (!referralCode) return null;

  const ua = navigator.userAgent;
  let os = "Unknown OS";
  if (ua.indexOf("Windows") !== -1) os = "Windows";
  else if (ua.indexOf("Macintosh") !== -1) os = "MacOS";
  else if (ua.indexOf("Linux") !== -1) os = "Linux";
  else if (ua.indexOf("Android") !== -1) os = "Android";
  else if (ua.indexOf("iPhone") !== -1 || ua.indexOf("iPad") !== -1) os = "iOS";

  const cores = navigator.hardwareConcurrency || "Unknown";
  const memory = navigator.deviceMemory || "Unknown";
  let connectionType = "Unknown", downlink = "Unknown", rtt = "Unknown";
  if (navigator.connection) {
    connectionType = navigator.connection.effectiveType || "Unknown";
    downlink = navigator.connection.downlink || "Unknown";
    rtt = navigator.connection.rtt || "Unknown";
  }

  const normalizedCode = referralCode.toUpperCase();
  const sessionVisitKey = `referral_visit_${normalizedCode}`;
  if (sessionStorage.getItem(sessionVisitKey)) return null;

  const visitBase = {
    referralCode: normalizedCode,
    browser: ua.substring(0, 200), os,
    hardware: `Cores: ${cores}, RAM: ${memory}GB`,
    network: `Type: ${connectionType}, Downlink: ${downlink}Mbps, RTT: ${rtt}ms`,
    device: getDeviceType(), language: navigator.language,
    link: window.location.href,
    visitedAt: new Date().toISOString(),
    ip: "Unknown", country: "Unknown", city: "Unknown",
    region: "Unknown", isp: "Unknown",
    action: "visited", matched: false,
  };

  try {
    const geoRes = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
    if (geoRes.ok) {
      const g = await geoRes.json();
      visitBase.ip = g.ip || "Unknown";
      visitBase.country = g.country_name || g.country || "Unknown";
      visitBase.city = g.city || "Unknown";
      visitBase.region = g.region || "Unknown";
      visitBase.isp = g.org || "Unknown";
    }
  } catch {
    try {
      const geoRes2 = await fetch("https://ip-api.com/json/", { signal: AbortSignal.timeout(4000) });
      if (geoRes2.ok) {
        const g2 = await geoRes2.json();
        visitBase.ip = g2.query || "Unknown";
        visitBase.country = g2.country || "Unknown";
        visitBase.city = g2.city || "Unknown";
        visitBase.region = g2.regionName || "Unknown";
        visitBase.isp = g2.isp || "Unknown";
      }
    } catch {}
  }

  try {
    const data = await apiFetch("/api/referral-visits", {
      method: "POST",
      body: JSON.stringify(visitBase),
    });
    sessionStorage.setItem(sessionVisitKey, data.data?.visitId || data.data?.id || normalizedCode);
    return data.data;
  } catch { return null; }
}

export async function processReferralFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("ref") || "").trim().toUpperCase();
  if (!code) {
    localStorage.removeItem("detected_referral_code");
    return { code: "", matched: false };
  }
  try { await trackReferralVisit(code); } catch {}
  const matched = await isReferralCodeMatched(code);
  if (matched) localStorage.setItem("detected_referral_code", code);
  else localStorage.removeItem("detected_referral_code");
  return { code, matched };
}

export async function markReferralContacted(referralCode) {
  if (!referralCode) return;
  const code = referralCode.toUpperCase();
  await apiFetch(`/api/referrals/${code}/contacted`, { method: "POST" });
}

export async function recordReferralLogin(referralCode, user) {
  if (!referralCode || !user?.uid) return;
  const code = String(referralCode).toUpperCase();
  try {
    await apiFetch("/api/referral-users", {
      method: "POST",
      body: JSON.stringify({ code, user: { uid: user.uid, name: user.displayName || "", email: user.email || "", photoURL: user.photoURL || "" }, isNew: true }),
    });
  } catch {}
}

// ─── Admin Management ────────────────────────────────
export async function checkAdminStatus(email) {
  if (!email) return { isAdmin: false };
  const root = "rutujdhodapkar@gmail.com";
  if (email.toLowerCase().trim() === root) return { isAdmin: true };
  try {
    return await apiFetch("/api/check-admin", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch { return { isAdmin: false }; }
}

export async function fetchAdmins() {
  try {
    const res = await apiFetch("/api/admins");
    return res.data || [];
  } catch { return []; }
}

export async function addAdmin(email) {
  const cleanEmail = email.toLowerCase().trim();
  await apiFetch("/api/admins", {
    method: "POST",
    body: JSON.stringify({ email: cleanEmail }),
  });
}

export async function removeAdmin(email) {
  const cleanEmail = email.toLowerCase().trim();
  await apiFetch(`/api/admins/${encodeURIComponent(cleanEmail)}`, { method: "DELETE" });
}

function getDeviceType() {
  const width = window.innerWidth;
  if (/Mobi|Android/i.test(navigator.userAgent) || width < 768) return "Mobile";
  if (/Tablet|iPad/i.test(navigator.userAgent) || width < 1100) return "Tablet";
  return "Desktop";
}

// ─── Self-Referral ──────────────────────────────────
export async function createSelfReferral(details, uid) {
  if (!uid) throw new Error("You must be logged in to create a referral code.");
  const { name, email, phone, college, city, country, upiId } = details;
  if (!name || !email || !phone || !college || !city || !country || !upiId) {
    throw new Error("Name, email, phone, college, city, country, and UPI ID are required.");
  }
  const res = await apiFetch("/api/self-referral", {
    method: "POST",
    body: JSON.stringify({ details, uid }),
  });
  return res.data;
}

export async function fetchSelfReferralCode(uid) {
  if (!uid) return null;
  try {
    const res = await apiFetch(`/api/self-referral-code/${uid}`);
    return res.data || null;
  } catch { return null; }
}

// ─── Referral Dashboard ──────────────────────────────
export async function fetchReferralDashboardData(uid) {
  if (!uid) return null;
  try {
    const res = await apiFetch(`/api/referral-dashboard/${uid}`);
    return res.data || null;
  } catch { return null; }
}

export async function fetchUserReferralStat(email) {
  if (!email) return null;
  try {
    const res = await apiFetch(`/api/user-referral-stat?email=${encodeURIComponent(email)}`);
    return res.data || null;
  } catch { return null; }
}

export async function fetchAdminReferralUsersWithInterns() {
  try {
    const res = await apiFetch("/api/admin-referral-users");
    return res.data || [];
  } catch { return []; }
}

export async function savePermanentReferralCode(uid, code) {
  if (!uid || !code) return;
  try {
    await apiFetch("/api/permanent-referral-code", {
      method: "POST",
      body: JSON.stringify({ uid, code }),
    });
  } catch {}
}

export async function fetchPermanentReferralCode(uid) {
  if (!uid) return null;
  try {
    const res = await apiFetch(`/api/permanent-referral-code/${uid}`);
    return res.data || null;
  } catch { return null; }
}

// ─── AI Task Verification ────────────────────────────
export async function verifyTaskWithAI({ taskTitle, taskDescription, submissionText, submissionUrl, internName }) {
  return await apiFetch("/api/ai/verify-task", {
    method: "POST",
    body: JSON.stringify({ taskTitle, taskDescription, submissionText, submissionUrl, internName }),
  });
}

// ─── Site Settings ───────────────────────────────────
export async function fetchEarnSettings() {
  try {
    const res = await apiFetch("/api/site-settings/earn");
    return res.data || { rewardPerCompletion: 20, milestoneCount: 50, milestoneBonus: 1000 };
  } catch { return { rewardPerCompletion: 20, milestoneCount: 50, milestoneBonus: 1000 }; }
}

export async function saveEarnSettings(settings) {
  try {
    await apiFetch("/api/site-settings/earn", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  } catch {}
}

export async function fetchEarnDetails() {
  try {
    const res = await apiFetch("/api/site-settings/earnDetails");
    if (res.data) return res.data;
  } catch {}
  return {
    title: "How Refer & Earn Works",
    description: "Share your unique referral link with friends and classmates. When they complete their internship you get paid.",
    items: [
      { title: "Apply Once", description: "Submit your UPI ID to get a unique referral code instantly.", links: "" },
      { title: "Share Your Link", description: "Share anywhere — WhatsApp, LinkedIn, or social media.", links: "" },
      { title: "Track Progress", description: "See who enrolled using your link and track completions in real time.", links: "" },
      { title: "Get Paid", description: "Earn ₹20 per completion + ₹1,000 bonus at 50 completions directly to your UPI.", links: "" },
    ],
  };
}

export async function saveEarnDetails(details) {
  try {
    await apiFetch("/api/site-settings/earnDetails", {
      method: "PUT",
      body: JSON.stringify(details),
    });
  } catch {}
}

// ─── Banned Users ────────────────────────────────────
export async function fetchBannedUsers() {
  try {
    const res = await apiFetch("/api/banned-users");
    return res.data || [];
  } catch { return []; }
}

export async function checkUserBan(email) {
  if (!email) return null;
  try {
    const res = await apiFetch(`/api/banned-users/check?email=${encodeURIComponent(email)}`);
    return res.data || null;
  } catch { return null; }
}

export async function banUser(email, banType, reason, bannedBy) {
  await apiFetch("/api/banned-users", {
    method: "POST",
    body: JSON.stringify({ email, banType: banType || "both", reason: reason || "", bannedBy: bannedBy || "" }),
  });
}

export async function unbanUser(email) {
  await apiFetch(`/api/banned-users/${encodeURIComponent(email)}`, { method: "DELETE" });
}

// ─── Admin Messages ─────────────────────────────────
export async function fetchAdminMessages(userEmail) {
  try {
    const url = userEmail ? `/api/admin-messages?email=${encodeURIComponent(userEmail)}` : "/api/admin-messages";
    const res = await apiFetch(url);
    return res.data || [];
  } catch { return []; }
}

export async function fetchAllAdminMessages() {
  try {
    const res = await apiFetch("/api/all-admin-messages");
    return res.data || [];
  } catch { return []; }
}

export async function saveAdminMessage(message) {
  const res = await apiFetch("/api/admin-messages", {
    method: "POST",
    body: JSON.stringify(message),
  });
  if (!res.data?.id) throw new Error("Failed to create message.");
  return res.data.id;
}

export async function deleteAdminMessage(id) {
  await apiFetch(`/api/admin-messages/${id}`, { method: "DELETE" });
}
