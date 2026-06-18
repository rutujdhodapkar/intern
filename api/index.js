let app;
try {
  app = (await import('../server/index.js')).default;
} catch (err) {
  console.error('Server init error:', err.message);
  const { default: express } = await import('express');
  app = express();
  app.all('*', (req, res) => res.status(500).json({ error: 'Server init failed', message: err.message }));
}
export default app;
