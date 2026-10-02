/** Instant health — no sql.js / Express load (proves Vercel function works). */
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    service: 'NexoraGo',
    route: 'api/health',
    platform: 'vercel',
    time: new Date().toISOString(),
  }));
};
