/** Instant health — also reports if Turso env vars exist (no secrets). */
module.exports = async (req, res) => {
  const rawUrl = String(process.env.TURSO_DATABASE_URL || '').trim();
  const hasUrl = !!rawUrl;
  const hasToken = !!(process.env.TURSO_AUTH_TOKEN && String(process.env.TURSO_AUTH_TOKEN).trim());
  let host = null;
  try {
    const u = rawUrl.replace(/^libsql:\/\//, 'https://');
    host = hasUrl ? new URL(u).hostname : null;
  } catch { host = 'invalid-url'; }

  let turso_ping = null;
  let turso_error = null;
  if (hasUrl && hasToken) {
    try {
      const { createClient } = require('@libsql/client/http');
      let url = rawUrl;
      if (url.startsWith('libsql://')) url = 'https://' + url.slice('libsql://'.length);
      const client = createClient({
        url,
        authToken: String(process.env.TURSO_AUTH_TOKEN).trim(),
      });
      await client.execute('SELECT 1 as ok');
      turso_ping = 'ok';
    } catch (err) {
      turso_ping = 'fail';
      turso_error = String(err.message || err);
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    service: 'NexoraGo',
    route: 'api/health',
    platform: 'vercel',
    turso_url: hasUrl,
    turso_host: host,
    turso_token: hasToken,
    turso_ping,
    turso_error,
    persistence: (hasUrl && hasToken) ? 'turso-env-present' : 'missing-turso-env',
    tip: (hasUrl && hasToken)
      ? (turso_ping === 'ok' ? 'Turso connected — try apply/track' : 'Turso env present but ping failed — check token matches this DB')
      : 'Add TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Vercel Settings → Environment Variables, then Redeploy',
    time: new Date().toISOString(),
  }));
};
