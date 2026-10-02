/**
 * Durable applications store on Turso (libSQL).
 * sql.js stays as the in-process API; Turso is the source of truth for orders/KYC.
 */
const { createClient } = require('@libsql/client');

let _client = null;

function hasTursoConfig() {
  return !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

function getClient() {
  if (!hasTursoConfig()) return null;
  if (_client) return _client;
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

async function ensureSchema() {
  const client = getClient();
  if (!client) return false;

  await client.executeMultiple(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  visa_id INTEGER NOT NULL,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  applicant_phone TEXT NOT NULL,
  passport_number TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  nationality TEXT,
  age INTEGER,
  date_of_birth TEXT,
  residence TEXT,
  current_city TEXT,
  preferred_city TEXT,
  job_id INTEGER,
  target_job TEXT,
  education TEXT,
  work_experience TEXT,
  language TEXT,
  visa_duration TEXT,
  purpose TEXT,
  occupation TEXT,
  employment_status TEXT,
  id_type TEXT,
  id_number TEXT,
  net_worth TEXT,
  annual_income TEXT,
  trip_funds TEXT,
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'assessment',
  payment_status TEXT NOT NULL DEFAULT 'n/a',
  order_status TEXT NOT NULL DEFAULT 'pending',
  kyc_status TEXT NOT NULL DEFAULT 'n/a',
  kyc_document_path TEXT,
  kyc_selfie_path TEXT,
  kyc_submitted_at TEXT,
  kyc_reviewed_at TEXT,
  kyc_notes TEXT,
  tx_hash TEXT,
  card_last4 TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  nationality TEXT NOT NULL,
  id_type TEXT NOT NULL,
  id_number TEXT NOT NULL,
  id_document_path TEXT NOT NULL,
  selfie_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  rejection_reason TEXT
);
`);
  return true;
}

function rowToObject(row) {
  // libsql rows are objects already in recent clients; normalize
  if (!row) return null;
  if (typeof row === 'object' && !Array.isArray(row)) return { ...row };
  return row;
}

async function pullAppsIntoDb(db) {
  const client = getClient();
  if (!client) return 0;

  await ensureSchema();

  const ordersRs = await client.execute('SELECT * FROM orders');
  const orders = (ordersRs.rows || []).map(rowToObject);
  if (!orders.length) {
    console.log('[TURSO] No applications in remote DB yet');
    return 0;
  }

  const find = db.prepare('SELECT id FROM orders WHERE id = ? OR order_number = ?');
  let added = 0;
  for (const o of orders) {
    if (!o || !o.id) continue;
    if (find.get(o.id, o.order_number)) continue;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined && k !== 'constructor');
    db.prepare(`INSERT INTO orders (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map((k) => o[k]));
    added++;
  }

  try {
    const kycRs = await client.execute('SELECT * FROM kyc_verifications');
    const kycRows = (kycRs.rows || []).map(rowToObject);
    const findK = db.prepare('SELECT id FROM kyc_verifications WHERE id = ?');
    for (const k of kycRows) {
      if (!k) continue;
      if (k.id != null && findK.get(k.id)) continue;
      const keys = Object.keys(k).filter((x) => k[x] !== undefined);
      db.prepare(`INSERT INTO kyc_verifications (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .run(...keys.map((x) => k[x]));
    }
  } catch (err) {
    console.error('[TURSO] KYC pull failed:', err.message);
  }

  console.log(`[TURSO] Pulled ${orders.length} applications (${added} new into memory)`);
  return orders.length;
}

async function pushAppsFromDb(db) {
  const client = getClient();
  if (!client) return 0;

  await ensureSchema();

  const orders = db.prepare('SELECT * FROM orders').all();
  const kyc = db.prepare('SELECT * FROM kyc_verifications').all();
  const batch = [];

  for (const o of orders) {
    const keys = Object.keys(o);
    const placeholders = keys.map(() => '?').join(',');
    const updates = keys.filter((k) => k !== 'id').map((k) => `${k}=excluded.${k}`).join(',');
    batch.push({
      sql: `INSERT INTO orders (${keys.join(',')}) VALUES (${placeholders})
            ON CONFLICT(id) DO UPDATE SET ${updates}`,
      args: keys.map((k) => o[k]),
    });
  }

  for (const k of kyc) {
    const keys = Object.keys(k);
    if (k.id != null) {
      const updates = keys.filter((x) => x !== 'id').map((x) => `${x}=excluded.${x}`).join(',');
      batch.push({
        sql: `INSERT INTO kyc_verifications (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
              ON CONFLICT(id) DO UPDATE SET ${updates}`,
        args: keys.map((x) => k[x]),
      });
    } else {
      batch.push({
        sql: `INSERT INTO kyc_verifications (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        args: keys.map((x) => k[x]),
      });
    }
  }

  if (batch.length) {
    await client.batch(batch, 'write');
  }

  // Sync deletes only when local has data (never wipe Turso on empty cold start)
  if (orders.length > 0) {
    const idSet = new Set(orders.map((o) => o.id));
    const remote = await client.execute('SELECT id FROM orders');
    const deletes = [];
    for (const r of remote.rows || []) {
      const id = r.id ?? r[0];
      if (id && !idSet.has(id)) {
        deletes.push({ sql: 'DELETE FROM kyc_verifications WHERE order_id = ?', args: [id] });
        deletes.push({ sql: 'DELETE FROM orders WHERE id = ?', args: [id] });
      }
    }
    if (deletes.length) await client.batch(deletes, 'write');
  }

  console.log(`[TURSO] Pushed ${orders.length} applications`);
  return orders.length;
}

module.exports = {
  hasTursoConfig,
  getClient,
  ensureSchema,
  pullAppsIntoDb,
  pushAppsFromDb,
};
