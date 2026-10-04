/** Instant health — also reports if Turso env vars exist (no secrets). */
module.exports = (req, res) => {
  const hasUrl = !!(process.env.TURSO_DATABASE_URL && String(process.env.TURSO_DATABASE_URL).trim());
  const hasToken = !!(process.env.TURSO_AUTH_TOKEN && String(process.env.TURSO_AUTH_TOKEN).trim());
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    service: 'NexoraGo',
    route: 'api/health',
    platform: 'vercel',
    turso_url: hasUrl,
    turso_token: hasToken,
    persistence: (hasUrl && hasToken) ? 'turso-env-present' : 'missing-turso-env',
    tip: (hasUrl && hasToken)
      ? 'Turso env found — try track/apply'
      : 'Add TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Vercel Settings → Environment Variables, then Redeploy',
    time: new Date().toISOString(),
  }));
};
