import express from 'express';

let app;

const ready = import('../server/index.js').then(m => {
  app = m.default;
}).catch(err => {
  console.error('Server init error:', err.message);
  app = express();
  app.all('*', (req, res) => res.status(500).json({ error: 'Server init failed', message: err.message }));
});

export default async (req, res) => {
  await ready;
  app(req, res);
  return new Promise(resolve => res.on('finish', resolve));
};
