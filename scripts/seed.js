import { initializeApp, cert } from 'firebase-admin/app';
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

const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

async function seed() {
  const batch = db.batch();

  // Career Paths
  const paths = [
    { id: 'web-dev', title: 'Web Development', description: 'Build modern websites and web applications using HTML, CSS, JavaScript, and frameworks.', icon: '🌐', color: '#3b82f6', duration: '3 months', projectCount: 5 },
    { id: 'app-dev', title: 'App Development', description: 'Create mobile applications for Android and iOS platforms.', icon: '📱', color: '#8b5cf6', duration: '3 months', projectCount: 5 },
    { id: 'data-science', title: 'Data Science', description: 'Analyze data, build ML models, and derive insights from complex datasets.', icon: '📊', color: '#10b981', duration: '3 months', projectCount: 5 },
    { id: 'cybersec', title: 'Cybersecurity', description: 'Learn ethical hacking, network security, and vulnerability assessment.', icon: '🔒', color: '#ef4444', duration: '3 months', projectCount: 5 },
    { id: 'cloud', title: 'Cloud Computing', description: 'Deploy and manage infrastructure on AWS, Azure, or Google Cloud.', icon: '☁️', color: '#f59e0b', duration: '3 months', projectCount: 5 },
  ];
  for (const p of paths) batch.set(db.collection('careerPaths').doc(p.id), p);

  // How It Works
  const steps = [
    { id: 'step_1', step: 1, title: 'Choose a Domain', description: 'Browse our internship domains and pick the one that matches your interests and career goals.', icon: '🎯' },
    { id: 'step_2', step: 2, title: 'Complete Projects', description: 'Work through real-world projects designed to build your skills and portfolio.', icon: '📝' },
    { id: 'step_3', step: 3, title: 'Get Certified', description: 'Receive a verified certificate upon successful completion of your projects.', icon: '🏆' },
  ];
  for (const s of steps) batch.set(db.collection('howItWorks').doc(s.id), s);

  // FAQs
  const faqs = [
    { id: 'faq_1', question: 'What is the duration of the internship?', answer: 'The internship typically lasts 3 months, but you can complete it at your own pace.' },
    { id: 'faq_2', question: 'Is this a paid internship?', answer: 'This is a skill-building internship focused on providing hands-on experience. Please check the payment section for details.' },
    { id: 'faq_3', question: 'Will I get a certificate?', answer: 'Yes, upon successful completion of all projects, you will receive a verified certificate.' },
    { id: 'faq_4', question: 'Can I work remotely?', answer: 'Yes, this is a fully remote internship. You can work from anywhere.' },
  ];
  for (const f of faqs) batch.set(db.collection('faqs').doc(f.id), f);

  // Payment Settings
  batch.set(db.collection('siteSettings').doc('payment'), {
    defaultAmount: 200,
    referredAmount: 170,
    domainOverrides: {},
  });

  // About Text
  batch.set(db.collection('config').doc('aboutText'), {
    text: 'We provide hands-on internship programs designed to bridge the gap between academic learning and industry requirements.',
  });

  await batch.commit();
  console.log('Seed data written successfully!');
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
