/**
 * Vercel serverless entry — lazy-load Express so cold start can answer health fast.
 */
module.exports = async (req, res) => {
  const started = Date.now();
  try {
    // Lazy require — avoid loading sql.js/express during module evaluate
    const serverless = require('serverless-http');
    const app = require('../server/server');

    if (!global.__nexoraReady) {
      global.__nexoraReady = app.ready().catch((err) => {
        global.__nexoraReady = null;
        throw err;
      });
    }

    const readyTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('DB init exceeded 7s')), 7000);
    });
    await Promise.race([global.__nexoraReady, readyTimeout]);

    const baseHandler = serverless(app, {
      binary: ['image/*', 'application/pdf'],
    });
    return await baseHandler(req, res);
  } catch (err) {
    console.error('[vercel api]', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'API warming up — retry in a few seconds',
      detail: String(err.message || err),
      ms: Date.now() - started,
      tip: 'Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Vercel → Settings → Environment Variables, then Redeploy',
    }));
  }
};
