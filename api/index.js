/**
 * Vercel entry — lightweight API (no Express/sql.js cold-start).
 */
const { handle } = require('../server/vercel-api');

module.exports = async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    console.error('[vercel api]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Request failed',
        detail: String(err.message || err),
        tip: 'Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN match your Turso dashboard, then Redeploy',
      }));
    }
  }
};
