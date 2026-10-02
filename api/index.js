/**
 * Vercel serverless entry — all /api/* routes (see vercel.json rewrites).
 * Fail fast on init so Vercel never returns FUNCTION_INVOCATION_TIMEOUT blankly.
 */
const serverless = require('serverless-http');
const app = require('../server/server');

const baseHandler = serverless(app, {
  binary: ['image/*', 'application/pdf'],
});

let readyPromise = null;

function ensureReady() {
  if (!readyPromise) {
    readyPromise = app.ready().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`API init exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

module.exports = async (req, res) => {
  try {
    // Leave headroom under Vercel hobby 10s limit
    await withTimeout(ensureReady(), 8000);
  } catch (err) {
    console.error('[vercel api] DB init failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'API warming up — retry in a few seconds',
      detail: String(err.message || err),
      tip: 'Confirm TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set in Vercel env',
    }));
    return;
  }

  try {
    return await baseHandler(req, res);
  } catch (err) {
    console.error('[vercel api] handler error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Request failed', detail: String(err.message || err) }));
  }
};
