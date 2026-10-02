const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const appsStore = require('./apps-store');
const turso = require('./turso');
const { isServerless, isNetlifyBlobs, platformLabel } = require('./runtime');

function IS_NETLIFY_BLOBS() {
  return isNetlifyBlobs();
}

/** Load local .env without a dependency (never commit secrets) */
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* ignore */ }
})();

const IS_SERVERLESS = isServerless();
const DATA_DIR = process.env.DATA_DIR
  || (IS_SERVERLESS
    ? path.join('/tmp', 'nexorago-data')
    : path.join(__dirname, '..', 'data'));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'visa-store.db');
const BLOB_KEY = 'visa-store.db';
const SCHEMA_VERSION = 9;

/** Tables that must NEVER be dropped/truncated by migrations or seed updates */
const PROTECTED_TABLES = ['orders', 'kyc_verifications'];

function assertSafeSql(sql) {
  const s = String(sql || '');
  const upper = s.toUpperCase();
  for (const table of PROTECTED_TABLES) {
    const dropRe = new RegExp(`DROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?["']?${table}["']?`, 'i');
    const truncRe = new RegExp(`DELETE\\s+FROM\\s+["']?${table}["']?\\s*;?\\s*$`, 'i');
    // Block bare DELETE FROM orders / kyc with no WHERE (wipe-all)
    const wipeRe = new RegExp(`DELETE\\s+FROM\\s+["']?${table}["']?(?!\\s+WHERE)`, 'i');
    if (dropRe.test(s) || (wipeRe.test(s) && !/\bWHERE\b/i.test(s))) {
      throw new Error(
        `[DB SAFETY] Blocked destructive SQL on "${table}". ` +
        'User applications must never be deleted by updates/migrations.'
      );
    }
  }
  return s;
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function resolveWasm() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  throw new Error('sql.js wasm not found — run npm install');
}

function loadSeedBaseBytes() {
  const candidates = [
    path.join(__dirname, 'seed-base.db'),
    path.join(process.cwd(), 'server', 'seed-base.db'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[DB] Using preseed ${p}`);
      return new Uint8Array(fs.readFileSync(p));
    }
  }
  return null;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function getBlobStore() {
  if (!IS_NETLIFY_BLOBS()) return null;
  try {
    const { getStore } = require('@netlify/blobs');
    // After connectLambda(event) in the function handler, this uses site credentials.
    return getStore({ name: 'nexorago-data', consistency: 'strong' });
  } catch (err) {
    console.error('[DB] Netlify Blobs unavailable:', err.message);
    return null;
  }
}

async function loadPersistentBytes() {
  const store = getBlobStore();
  if (store) {
    try {
      const buf = await store.get(BLOB_KEY, { type: 'arrayBuffer' });
      if (buf && buf.byteLength) {
        console.log(`[DB] Loaded ${buf.byteLength} bytes from Netlify Blobs`);
        return new Uint8Array(buf);
      }
      console.log('[DB] Netlify Blobs store empty (no saved applications yet)');
    } catch (err) {
      console.error('[DB] Blob load failed:', err.message);
    }
  } else if (IS_NETLIFY_BLOBS()) {
    console.error('[DB] WARNING: Blobs store null — applications may not persist');
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      return new Uint8Array(fs.readFileSync(DB_PATH));
    } catch {
      return null;
    }
  }
  return null;
}

let _persistChain = Promise.resolve();

async function savePersistentBytes(bytes) {
  // Local /tmp or disk snapshot (best-effort; Turso is source of truth for apps)
  if (!IS_SERVERLESS || !turso.hasTursoConfig()) {
    try {
      fs.writeFileSync(DB_PATH, Buffer.from(bytes));
    } catch (err) {
      console.error('[DB] local persist failed:', err.message);
    }
  } else {
    try {
      fs.writeFileSync(DB_PATH, Buffer.from(bytes));
    } catch { /* /tmp may be full — ignore */ }
  }

  const store = getBlobStore();
  if (store) {
    try {
      await store.set(BLOB_KEY, bytes);
      console.log(`[DB] Saved ${bytes.byteLength || bytes.length} bytes to Netlify Blobs (sqlite)`);
    } catch (err) {
      console.error('[DB] sqlite Blob save failed:', err.message);
    }
  } else if (IS_NETLIFY_BLOBS()) {
    console.error('[DB] WARNING: sqlite Blobs store null');
  }

  // JSON backup only when Turso is unavailable (slow on cold start)
  if (!turso.hasTursoConfig()) {
    const live = _db;
    if (live) {
      try {
        await appsStore.saveAppsBackup(live);
      } catch (err) {
        console.error('[DB] apps backup failed:', err.message);
      }
    }
  }
}

function queuePersist(bytes) {
  _persistChain = _persistChain
    .then(() => savePersistentBytes(bytes))
    .catch((err) => console.error('[DB] persist queue error:', err.message));
  return _persistChain;
}

async function flushPersist(opts = {}) {
  await _persistChain;
  const shouldPush = opts.pushTurso !== false;
  if (shouldPush && _db && turso.hasTursoConfig()) {
    try {
      await turso.pushAppsFromDb(_db);
    } catch (err) {
      console.error('[DB] Turso push failed:', err.message);
    }
  }
}

/** Wrap sql.js so call sites can keep using DatabaseSync-style prepare().get/all/run */
function wrapSqlJs(SQL, fileBytes) {
  const raw = fileBytes ? new SQL.Database(fileBytes) : new SQL.Database();
  let persistEnabled = true;

  function persist() {
    if (!persistEnabled) return;
    try {
      const data = raw.export();
      queuePersist(data);
    } catch (err) {
      console.error('[DB] persist failed:', err.message);
    }
  }

  /** Run many writes without exporting/saving the DB on every INSERT (critical for Vercel cold start). */
  function withBulk(fn) {
    const prev = persistEnabled;
    persistEnabled = false;
    try {
      return fn();
    } finally {
      persistEnabled = prev;
    }
  }

  function prepare(sql) {
    return {
      all(...params) {
        const stmt = raw.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },
      get(...params) {
        const rows = this.all(...params);
        return rows[0];
      },
      run(...params) {
        assertSafeSql(sql);
        raw.run(sql, params);
        const idRow = raw.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRow[0]?.values?.[0]?.[0] ?? 0;
        const changesRow = raw.exec('SELECT changes() AS c');
        const changes = changesRow[0]?.values?.[0]?.[0] ?? 0;
        persist();
        return { lastInsertRowid, changes };
      },
    };
  }

  function exec(sql) {
    assertSafeSql(sql);
    raw.exec(sql);
    persist();
  }

  return { prepare, exec, withBulk, _raw: raw, _persist: persist, flushPersist };
}

function tableExists(db, name) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
  return !!row;
}

function columnExists(db, table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === column);
  } catch {
    return false;
  }
}

/**
 * SAFE MIGRATE RULES (do not break):
 * 1. NEVER DROP TABLE orders / kyc_verifications
 * 2. NEVER DELETE FROM orders without a specific WHERE (admin single-delete OK)
 * 3. Only ADD COLUMN / CREATE TABLE IF NOT EXISTS
 * 4. Seed visas/jobs with INSERT OR IGNORE / insert-if-missing only
 * User applications must survive every Netlify redeploy and code update.
 */
function migrateIfNeeded(db) {
  let version = 0;
  try {
    const row = db.prepare('PRAGMA user_version').get();
    version = row?.user_version ?? 0;
  } catch { /* empty db */ }

  // Additive column upgrades for older DBs (preserve all application rows)
  if (tableExists(db, 'orders')) {
    const addCols = [
      ['current_city', 'TEXT'],
      ['preferred_city', 'TEXT'],
      ['job_id', 'INTEGER'],
      ['target_job', 'TEXT'],
    ];
    for (const [col, typ] of addCols) {
      if (!columnExists(db, 'orders', col)) {
        try {
          db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${typ}`);
          console.log(`[DB] Added orders.${col}`);
        } catch (err) {
          console.error(`[DB] ALTER orders.${col} failed:`, err.message);
        }
      }
    }
  }

  if (version < SCHEMA_VERSION) {
    console.log(`[DB] Schema ${version} → ${SCHEMA_VERSION} (PROTECTED: orders kept)`);
  }
}

function createSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS visas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  flag_emoji TEXT NOT NULL,
  visa_type TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  processing_days INTEGER NOT NULL,
  validity_days INTEGER NOT NULL,
  entries TEXT NOT NULL,
  requirements TEXT NOT NULL,
  description TEXT NOT NULL,
  popular INTEGER DEFAULT 0,
  UNIQUE(country_code, visa_type, category)
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  city TEXT NOT NULL,
  category TEXT NOT NULL,
  salary_range TEXT,
  visa_support INTEGER DEFAULT 1,
  description TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const VISA_DATA = [
  { code: 'CA', name: 'Canada', flag: '🇨🇦', type: 'Express Entry (PR)', category: 'work', price: 0, processing: 180, validity: 1825, entries: 'Permanent', reqs: ['Valid passport', 'IELTS / CELPIP', 'ECA', 'Work experience', 'Proof of funds'], desc: 'Top PR pathway for skilled workers via Express Entry and PNP.', popular: 1 },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', type: 'Visitor Visa (TRV)', category: 'tourist', price: 0, processing: 21, validity: 3650, entries: 'Multiple', reqs: ['Passport', 'Proof of funds', 'Ties to home'], desc: 'Canadian visitor visa for tourism and family visits.', popular: 1 },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', type: 'Study Permit', category: 'student', price: 0, processing: 30, validity: 3650, entries: 'Multiple', reqs: ['LOA', 'Proof of funds', 'Language test'], desc: 'Study in Canada with work rights during studies.', popular: 0 },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', type: 'EU Blue Card', category: 'work', price: 0, processing: 60, validity: 1460, entries: 'Multiple', reqs: ['Job offer', 'Degree', 'Salary threshold'], desc: 'EU Blue Card for engineers and IT professionals.', popular: 1 },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', type: 'Skilled Worker Visa', category: 'work', price: 0, processing: 60, validity: 1460, entries: 'Multiple', reqs: ['Job contract', 'Qualification recognition'], desc: 'Germany skilled worker pathway outside Blue Card thresholds.', popular: 1 },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', type: 'Schengen Visa (C)', category: 'tourist', price: 0, processing: 10, validity: 180, entries: 'Single/Multiple', reqs: ['Travel insurance', 'Bank statements'], desc: 'Short-stay Schengen for Germany and 29 countries.', popular: 0 },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', type: 'Skilled Worker Visa', category: 'work', price: 0, processing: 21, validity: 1825, entries: 'Multiple', reqs: ['CoS', 'English', 'Salary threshold'], desc: 'UK sponsored work visa with large Indian community.', popular: 1 },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', type: 'Graduate Visa', category: 'work', price: 0, processing: 14, validity: 730, entries: 'Multiple', reqs: ['UK degree', 'Student visa history'], desc: 'Post-study work without sponsorship for 2–3 years.', popular: 1 },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', type: 'Standard Visitor Visa', category: 'tourist', price: 0, processing: 15, validity: 1825, entries: 'Multiple', reqs: ['Bank statements', 'Itinerary'], desc: 'UK visitor visa for tourism and short business.', popular: 0 },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', type: 'Highly Skilled Migrant', category: 'work', price: 0, processing: 30, validity: 1825, entries: 'Multiple', reqs: ['Recognized sponsor', 'Salary criterion'], desc: 'English-friendly tech hub work permit.', popular: 1 },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', type: 'Critical Skills Employment Permit', category: 'work', price: 0, processing: 45, validity: 730, entries: 'Multiple', reqs: ['Critical Skills job', 'Degree'], desc: 'Ireland tech and EU-access pathway.', popular: 1 },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', type: 'D3 Highly Qualified Worker', category: 'work', price: 0, processing: 60, validity: 730, entries: 'Multiple', reqs: ['Qualified job', 'Degree'], desc: 'Portugal residency track for qualified workers.', popular: 1 },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', type: 'Work Permit', category: 'work', price: 0, processing: 60, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Collective agreement'], desc: 'Sweden work permit for tech and engineering.', popular: 1 },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', type: 'Skilled Independent (189/190)', category: 'work', price: 0, processing: 180, validity: 1825, entries: 'Permanent', reqs: ['Skills assessment', 'Points test', 'English'], desc: 'Australia points-based PR for skilled migrants.', popular: 1 },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', type: 'Visitor Visa (600)', category: 'tourist', price: 0, processing: 20, validity: 365, entries: 'Single/Multiple', reqs: ['Funds', 'Itinerary'], desc: 'Australian visitor visa.', popular: 0 },
  { code: 'US', name: 'United States', flag: '🇺🇸', type: 'H-1B Specialty Occupation', category: 'work', price: 0, processing: 90, validity: 1095, entries: 'Multiple', reqs: ['US employer petition', 'Degree', 'LCA'], desc: 'US specialty occupation visa for IT and skilled roles.', popular: 1 },
  { code: 'US', name: 'United States', flag: '🇺🇸', type: 'Tourist Visa (B1/B2)', category: 'tourist', price: 0, processing: 14, validity: 3650, entries: 'Multiple', reqs: ['DS-160', 'Interview'], desc: 'US B1/B2 tourist and business visitor.', popular: 1 },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', type: 'Employment Visa', category: 'work', price: 0, processing: 14, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Medical', 'Attested docs'], desc: 'UAE employment visa — tax-free Gulf careers.', popular: 1 },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', type: 'Tourist Visa', category: 'tourist', price: 0, processing: 3, validity: 60, entries: 'Single/Multiple', reqs: ['Passport', 'Hotel'], desc: 'UAE tourist visa for Dubai and emirates.', popular: 0 },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', type: 'Skilled Migrant Category', category: 'work', price: 0, processing: 120, validity: 1825, entries: 'Permanent', reqs: ['Points', 'Job / skills', 'English'], desc: 'NZ skilled migrant pathway for PR.', popular: 1 },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', type: 'Employment Pass', category: 'work', price: 0, processing: 21, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Salary threshold', 'Degree'], desc: 'Singapore EP for professionals in Asia hub.', popular: 1 },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', type: 'Engineer / Specialist in Humanities', category: 'work', price: 0, processing: 45, validity: 1095, entries: 'Multiple', reqs: ['Job offer', 'Degree', 'COE'], desc: 'Japan work visa for engineers and specialists.', popular: 1 },
  { code: 'FR', name: 'France', flag: '🇫🇷', type: 'Talent Passport / Salarié', category: 'work', price: 0, processing: 60, validity: 1460, entries: 'Multiple', reqs: ['Job contract', 'Degree'], desc: 'France skilled worker and talent routes.', popular: 1 },
  { code: 'PL', name: 'Poland', flag: '🇵🇱', type: 'National Work Visa (D)', category: 'work', price: 0, processing: 30, validity: 365, entries: 'Multiple', reqs: ['Work permit / declaration', 'Job offer'], desc: 'Poland work visa — EU entry for many roles.', popular: 1 },
  { code: 'MT', name: 'Malta', flag: '🇲🇹', type: 'Single Permit (Work)', category: 'work', price: 0, processing: 45, validity: 365, entries: 'Multiple', reqs: ['Job offer', 'Qualifications'], desc: 'Malta English-speaking EU work permit.', popular: 0 },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', type: 'Work Visa (Iqama track)', category: 'work', price: 0, processing: 21, validity: 730, entries: 'Multiple', reqs: ['Sponsor', 'Medical', 'Attested docs'], desc: 'Saudi work visa for Vision 2030 job demand.', popular: 1 },
  { code: 'QA', name: 'Qatar', flag: '🇶🇦', type: 'Work Residence Permit', category: 'work', price: 0, processing: 21, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Medical'], desc: 'Qatar employment for skilled and hospitality roles.', popular: 0 },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', type: 'Employment Pass', category: 'work', price: 0, processing: 30, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Qualifications'], desc: 'Malaysia EP for professionals in KL and tech parks.', popular: 0 },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', type: 'E-7 Specialty Occupation', category: 'work', price: 0, processing: 45, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Degree / experience'], desc: 'Korea E-7 for skilled specialty workers.', popular: 0 },
  { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿', type: 'Employee Card', category: 'work', price: 0, processing: 60, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Qualifications'], desc: 'Czech Employee Card for EU work and stay.', popular: 0 },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', type: 'Work Visa (Decreto Flussi / Blue Card)', category: 'work', price: 0, processing: 60, validity: 730, entries: 'Multiple', reqs: ['Quota / Blue Card job', 'Contract'], desc: 'Italy work routes for skilled and seasonal demand.', popular: 0 },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', type: 'Highly Qualified / Work Visa', category: 'work', price: 0, processing: 60, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Degree'], desc: 'Spain highly qualified and work residence.', popular: 1 },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', type: 'Specialist Residence Permit', category: 'work', price: 0, processing: 45, validity: 730, entries: 'Multiple', reqs: ['Job offer', 'Salary threshold'], desc: 'Finland specialist permit for tech talent.', popular: 0 },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', type: 'Pay Limit / Positive List', category: 'work', price: 0, processing: 30, validity: 1460, entries: 'Multiple', reqs: ['Job offer', 'Salary / Positive List'], desc: 'Denmark work schemes for skilled professionals.', popular: 0 },
];

const JOB_DATA = [
  { title: 'Software Engineer', company: 'NorthPeak Tech', code: 'CA', name: 'Canada', city: 'Toronto', category: 'IT', salary: 'CAD 38k–120k', desc: 'Full-stack role with PR-friendly employer support.' },
  { title: 'Cloud / DevOps Engineer', company: 'Maple Cloud', code: 'CA', name: 'Canada', city: 'Vancouver', category: 'IT', salary: 'CAD 40k–130k', desc: 'AWS/Azure DevOps with Express Entry friendly profile.' },
  { title: 'Registered Nurse', company: 'CareBridge Health', code: 'CA', name: 'Canada', city: 'Calgary', category: 'Healthcare', salary: 'CAD 30k–95k', desc: 'Hospital nursing roles with licensing guidance.' },
  { title: 'Java Backend Developer', company: 'Berlin SoftLabs', code: 'DE', name: 'Germany', city: 'Berlin', category: 'IT', salary: '€25k–75k', desc: 'EU Blue Card eligible backend engineering.' },
  { title: 'Mechanical Engineer', company: 'AutoTechnik GmbH', code: 'DE', name: 'Germany', city: 'Stuttgart', category: 'Engineering', salary: '€22k–70k', desc: 'Automotive OEM supplier — skilled worker visa.' },
  { title: 'Data Engineer', company: 'Rhine Analytics', code: 'DE', name: 'Germany', city: 'Munich', category: 'IT', salary: '€27k–80k', desc: 'Python/Spark pipelines, Blue Card salary band.' },
  { title: 'Full Stack Developer', company: 'Thames Digital', code: 'GB', name: 'United Kingdom', city: 'London', category: 'IT', salary: '£20k–70k', desc: 'Skilled Worker visa sponsorship available.' },
  { title: 'Product Manager', company: 'Northern Apps', code: 'GB', name: 'United Kingdom', city: 'Manchester', category: 'Product', salary: '£22k–75k', desc: 'SaaS product role with CoS sponsorship.' },
  { title: 'Healthcare Assistant', company: 'CareUK Partners', code: 'GB', name: 'United Kingdom', city: 'Birmingham', category: 'Healthcare', salary: '£10k–32k', desc: 'Care sector demand with visa support pathways.' },
  { title: 'Frontend Engineer', company: 'Dam Digital', code: 'NL', name: 'Netherlands', city: 'Amsterdam', category: 'IT', salary: '€22k–70k', desc: 'Highly Skilled Migrant eligible React role.' },
  { title: 'QA Automation Engineer', company: 'Eindhoven Labs', code: 'NL', name: 'Netherlands', city: 'Eindhoven', category: 'IT', salary: '€20k–62k', desc: 'Embedded/test automation with HSM sponsor.' },
  { title: 'Software Engineer', company: 'Liffey Tech', code: 'IE', name: 'Ireland', city: 'Dublin', category: 'IT', salary: '€20k–70k', desc: 'Critical Skills list occupation.' },
  { title: 'Account Manager', company: 'Atlantic Sales', code: 'IE', name: 'Ireland', city: 'Cork', category: 'Sales', salary: '€15k–50k', desc: 'B2B SaaS sales with EU base.' },
  { title: 'Full Stack Developer', company: 'Lisboa Code', code: 'PT', name: 'Portugal', city: 'Lisbon', category: 'IT', salary: '€13k–48k', desc: 'D3 qualified worker track.' },
  { title: 'Data Scientist', company: 'Nordic Insight', code: 'SE', name: 'Sweden', city: 'Stockholm', category: 'IT', salary: 'SEK 200k–650k', desc: 'Work permit for AI/ML talent.' },
  { title: 'Civil Engineer', company: 'Harbour Build', code: 'AU', name: 'Australia', city: 'Sydney', category: 'Engineering', salary: 'AUD 40k–130k', desc: 'Points-friendly engineering role.' },
  { title: 'Software Engineer', company: 'Outback Cloud', code: 'AU', name: 'Australia', city: 'Melbourne', category: 'IT', salary: 'AUD 40k–140k', desc: 'Skilled migration aligned tech role.' },
  { title: 'Software Engineer', company: 'Bay Area Systems', code: 'US', name: 'United States', city: 'San Francisco', category: 'IT', salary: 'USD 50k–170k', desc: 'H-1B specialty occupation track.' },
  { title: 'Data Analyst', company: 'Austin Metrics', code: 'US', name: 'United States', city: 'Austin', category: 'IT', salary: 'USD 38k–115k', desc: 'Analytics role for specialty visa profiles.' },
  { title: 'Software Engineer', company: 'Dubai FinTech', code: 'AE', name: 'United Arab Emirates', city: 'Dubai', category: 'IT', salary: 'AED 6k–25k/mo', desc: 'Tax-free tech role with employment visa.' },
  { title: 'Hospitality Supervisor', company: 'Gulf Hotels Group', code: 'AE', name: 'United Arab Emirates', city: 'Abu Dhabi', category: 'Hospitality', salary: 'AED 3.5k–14k/mo', desc: 'Hotel operations with sponsor visa.' },
  { title: 'Software Developer', company: 'Kiwi Soft', code: 'NZ', name: 'New Zealand', city: 'Auckland', category: 'IT', salary: 'NZD 35k–110k', desc: 'Skilled Migrant aligned developer role.' },
  { title: 'Cloud Engineer', company: 'Lion City Cloud', code: 'SG', name: 'Singapore', city: 'Singapore', category: 'IT', salary: 'SGD 2.5k–10k/mo', desc: 'Employment Pass for cloud talent.' },
  { title: 'Embedded Software Engineer', company: 'Tokyo Devices', code: 'JP', name: 'Japan', city: 'Tokyo', category: 'IT', salary: 'JPY 2.5M–8M', desc: 'Engineer visa with COE support.' },
  { title: 'Backend Developer', company: 'Paris SaaS', code: 'FR', name: 'France', city: 'Paris', category: 'IT', salary: '€18k–60k', desc: 'Talent Passport / salarié eligible.' },
  { title: 'Warehouse Operative', company: 'Warsaw Logistics', code: 'PL', name: 'Poland', city: 'Warsaw', category: 'Logistics', salary: 'PLN 2k–7k/mo', desc: 'Work visa with employer declaration.' },
  { title: 'iOS Developer', company: 'Madrid Mobile', code: 'ES', name: 'Spain', city: 'Madrid', category: 'IT', salary: '€15k–55k', desc: 'Highly qualified worker route.' },
  { title: 'Site Engineer', company: 'Riyadh Projects', code: 'SA', name: 'Saudi Arabia', city: 'Riyadh', category: 'Engineering', salary: 'SAR 4k–18k/mo', desc: 'Construction demand with work visa.' },
  { title: 'Chef de Partie', company: 'Doha Dining', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Hospitality', salary: 'QAR 1.5k–7k/mo', desc: 'Hospitality employment residence.' },
  { title: 'Cybersecurity Analyst', company: 'KL Secure', code: 'MY', name: 'Malaysia', city: 'Kuala Lumpur', category: 'IT', salary: 'MYR 3k–12k/mo', desc: 'Employment Pass for security talent.' },

  // Labour / service / care / driving roles
  { title: 'Cook / Kitchen Staff', company: 'Toronto Kitchen Co', code: 'CA', name: 'Canada', city: 'Toronto', category: 'Hospitality', salary: 'CAD 18k–45k', desc: 'Restaurant and hotel kitchen cook roles with visa pathway support.' },
  { title: 'Light Vehicle Driver', company: 'Maple Transit', code: 'CA', name: 'Canada', city: 'Mississauga', category: 'Driving', salary: 'CAD 20k–55k', desc: 'Company driver for logistics and staff transport.' },
  { title: 'Female Nurse (Care Home)', company: 'Maple Care Homes', code: 'CA', name: 'Canada', city: 'Vancouver', category: 'Healthcare', salary: 'CAD 28k–70k', desc: 'Female nurse / care roles in nursing homes and clinics.' },
  { title: 'Female Child Care Taker', company: 'Little Steps Daycare', code: 'CA', name: 'Canada', city: 'Calgary', category: 'Care', salary: 'CAD 16k–42k', desc: 'Female childcare / nanny roles for families and daycare centres.' },
  { title: 'Receptionist', company: 'North Office Services', code: 'CA', name: 'Canada', city: 'Ottawa', category: 'Reception', salary: 'CAD 18k–48k', desc: 'Front desk receptionist for clinics, hotels, and offices.' },
  { title: 'General Labour Worker', company: 'BuildRight Canada', code: 'CA', name: 'Canada', city: 'Edmonton', category: 'Labour', salary: 'CAD 18k–50k', desc: 'Construction and warehouse general labour with employer support.' },
  { title: 'Heavy Machinery Driver', company: 'Prairie Heavy Ops', code: 'CA', name: 'Canada', city: 'Winnipeg', category: 'Driving', salary: 'CAD 25k–70k', desc: 'Excavator / loader / heavy equipment operator roles.' },

  { title: 'Cook', company: 'Berlin Bistro Group', code: 'DE', name: 'Germany', city: 'Berlin', category: 'Hospitality', salary: '€14k–32k', desc: 'Hotel and restaurant cook positions with work visa support.' },
  { title: 'Truck / Delivery Driver', company: 'Rhine Freight', code: 'DE', name: 'Germany', city: 'Frankfurt', category: 'Driving', salary: '€16k–40k', desc: 'Delivery and truck driving for logistics companies.' },
  { title: 'Female Nurse', company: 'Munich Care Clinic', code: 'DE', name: 'Germany', city: 'Munich', category: 'Healthcare', salary: '€22k–48k', desc: 'Female nurse roles in clinics and elderly care.' },
  { title: 'Female Child Care Taker', company: 'KinderHaus Berlin', code: 'DE', name: 'Germany', city: 'Berlin', category: 'Care', salary: '€14k–30k', desc: 'Female childcare assistant / childminder roles.' },
  { title: 'Hotel Receptionist', company: 'Bavaria Hotels', code: 'DE', name: 'Germany', city: 'Munich', category: 'Reception', salary: '€15k–32k', desc: 'Front desk receptionist for hotels and guest houses.' },
  { title: 'Factory Labour Worker', company: 'Industrie Werk NRW', code: 'DE', name: 'Germany', city: 'Cologne', category: 'Labour', salary: '€15k–35k', desc: 'Factory and production line general labour.' },
  { title: 'Heavy Machinery Operator', company: 'BauTech Machines', code: 'DE', name: 'Germany', city: 'Hamburg', category: 'Driving', salary: '€18k–42k', desc: 'Construction heavy machinery driver / operator.' },

  { title: 'Cook / Chef Assistant', company: 'London Kitchen Staffing', code: 'GB', name: 'United Kingdom', city: 'London', category: 'Hospitality', salary: '£12k–28k', desc: 'Cook and kitchen assistant roles in hotels and restaurants.' },
  { title: 'Taxi / Private Hire Driver', company: 'CityRide UK', code: 'GB', name: 'United Kingdom', city: 'Manchester', category: 'Driving', salary: '£12k–30k', desc: 'Driver roles for private hire and company fleets.' },
  { title: 'Female Nurse', company: 'NHS Care Partners', code: 'GB', name: 'United Kingdom', city: 'Birmingham', category: 'Healthcare', salary: '£14k–35k', desc: 'Female nurse and care home nursing support roles.' },
  { title: 'Female Child Care Taker', company: 'BrightKids Nursery', code: 'GB', name: 'United Kingdom', city: 'Leeds', category: 'Care', salary: '£11k–26k', desc: 'Female childcare / nursery assistant positions.' },
  { title: 'Receptionist', company: 'Central Desk UK', code: 'GB', name: 'United Kingdom', city: 'London', category: 'Reception', salary: '£12k–28k', desc: 'Office and clinic receptionist roles.' },
  { title: 'Warehouse Labour', company: 'Midlands Logistics', code: 'GB', name: 'United Kingdom', city: 'Birmingham', category: 'Labour', salary: '£12k–28k', desc: 'Warehouse packing and general labour work.' },
  { title: 'Heavy Goods / Machinery Driver', company: 'UK Plant Hire', code: 'GB', name: 'United Kingdom', city: 'Manchester', category: 'Driving', salary: '£14k–36k', desc: 'HGV and heavy machinery driving roles.' },

  { title: 'Cook', company: 'Dubai Hotel Kitchens', code: 'AE', name: 'United Arab Emirates', city: 'Dubai', category: 'Hospitality', salary: 'AED 1.8k–5k/mo', desc: 'Hotel and restaurant cook with employment visa.' },
  { title: 'Company Driver', company: 'Gulf Fleet Services', code: 'AE', name: 'United Arab Emirates', city: 'Dubai', category: 'Driving', salary: 'AED 1.5k–4.5k/mo', desc: 'Light vehicle company driver for offices and hotels.' },
  { title: 'Female Nurse', company: 'Emirates Care Clinics', code: 'AE', name: 'United Arab Emirates', city: 'Abu Dhabi', category: 'Healthcare', salary: 'AED 3k–9k/mo', desc: 'Female nurse roles in clinics and home care.' },
  { title: 'Female Child Care Taker / Nanny', company: 'Family Care Gulf', code: 'AE', name: 'United Arab Emirates', city: 'Dubai', category: 'Care', salary: 'AED 1.5k–4k/mo', desc: 'Female childcare / nanny for family sponsorship.' },
  { title: 'Receptionist', company: 'Palm Front Desk', code: 'AE', name: 'United Arab Emirates', city: 'Dubai', category: 'Reception', salary: 'AED 2k–5.5k/mo', desc: 'Hotel and office receptionist roles.' },
  { title: 'General Labour / Helper', company: 'Desert Build LLC', code: 'AE', name: 'United Arab Emirates', city: 'Sharjah', category: 'Labour', salary: 'AED 1.2k–3.5k/mo', desc: 'Construction site helper and general labour.' },
  { title: 'Heavy Machinery Driver', company: 'Gulf Heavy Equipment', code: 'AE', name: 'United Arab Emirates', city: 'Abu Dhabi', category: 'Driving', salary: 'AED 2.5k–7k/mo', desc: 'Crane / excavator / heavy machinery operators.' },

  { title: 'Cook', company: 'Riyadh Catering Co', code: 'SA', name: 'Saudi Arabia', city: 'Riyadh', category: 'Hospitality', salary: 'SAR 1.5k–4.5k/mo', desc: 'Kitchen cook for hotels, camps, and catering.' },
  { title: 'Driver', company: 'Najd Transport', code: 'SA', name: 'Saudi Arabia', city: 'Jeddah', category: 'Driving', salary: 'SAR 1.5k–4k/mo', desc: 'Company and staff transport driver roles.' },
  { title: 'Female Nurse', company: 'Kingdom Care Hospitals', code: 'SA', name: 'Saudi Arabia', city: 'Riyadh', category: 'Healthcare', salary: 'SAR 3k–9k/mo', desc: 'Female nurse positions in hospitals and clinics.' },
  { title: 'Female Child Care Taker', company: 'Family Support KSA', code: 'SA', name: 'Saudi Arabia', city: 'Jeddah', category: 'Care', salary: 'SAR 1.5k–4k/mo', desc: 'Female childcare / domestic care roles.' },
  { title: 'Receptionist', company: 'Oasis Front Office', code: 'SA', name: 'Saudi Arabia', city: 'Dammam', category: 'Reception', salary: 'SAR 1.8k–4.5k/mo', desc: 'Reception and guest relations roles.' },
  { title: 'Construction Labour', company: 'Vision Build KSA', code: 'SA', name: 'Saudi Arabia', city: 'Riyadh', category: 'Labour', salary: 'SAR 1.2k–3.8k/mo', desc: 'Site labour and helper roles on construction projects.' },
  { title: 'Heavy Machinery Driver', company: 'Saudi Plant Ops', code: 'SA', name: 'Saudi Arabia', city: 'Khobar', category: 'Driving', salary: 'SAR 2.5k–8k/mo', desc: 'Heavy equipment and machinery drivers for sites.' },

  { title: 'Cook', company: 'Sydney Kitchen Crew', code: 'AU', name: 'Australia', city: 'Sydney', category: 'Hospitality', salary: 'AUD 22k–55k', desc: 'Cook roles in cafes, hotels, and catering.' },
  { title: 'Delivery / Truck Driver', company: 'Aussie Freight Local', code: 'AU', name: 'Australia', city: 'Melbourne', category: 'Driving', salary: 'AUD 24k–60k', desc: 'Delivery and truck driving across metro routes.' },
  { title: 'Female Nurse', company: 'Aussie Care Nursing', code: 'AU', name: 'Australia', city: 'Brisbane', category: 'Healthcare', salary: 'AUD 28k–75k', desc: 'Female nurse roles in aged care and clinics.' },
  { title: 'Female Child Care Taker', company: 'DownUnder Kids Care', code: 'AU', name: 'Australia', city: 'Perth', category: 'Care', salary: 'AUD 18k–48k', desc: 'Female childcare educator / assistant roles.' },
  { title: 'Receptionist', company: 'Harbour Desk Services', code: 'AU', name: 'Australia', city: 'Sydney', category: 'Reception', salary: 'AUD 20k–52k', desc: 'Reception roles for offices, clinics, and hotels.' },
  { title: 'Farm / General Labour', company: 'Outback Labour Hire', code: 'AU', name: 'Australia', city: 'Adelaide', category: 'Labour', salary: 'AUD 18k–50k', desc: 'Farm and general labour seasonal and full-time roles.' },
  { title: 'Heavy Machinery Driver', company: 'Oz Plant Operators', code: 'AU', name: 'Australia', city: 'Brisbane', category: 'Driving', salary: 'AUD 28k–75k', desc: 'Excavator and heavy machinery operator jobs.' },

  { title: 'Cook', company: 'Doha Kitchen Staff', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Hospitality', salary: 'QAR 1.2k–4k/mo', desc: 'Cook and kitchen helper with work residence.' },
  { title: 'Driver', company: 'Qatar Fleet Co', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Driving', salary: 'QAR 1.2k–3.8k/mo', desc: 'Company driver for staff and logistics.' },
  { title: 'Female Nurse', company: 'Qatar Care Nurses', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Healthcare', salary: 'QAR 2.5k–7k/mo', desc: 'Female nurse roles in hospitals and home care.' },
  { title: 'Female Child Care Taker', company: 'Lusail Family Care', code: 'QA', name: 'Qatar', city: 'Lusail', category: 'Care', salary: 'QAR 1.2k–3.5k/mo', desc: 'Female nanny / childcare for families.' },
  { title: 'Receptionist', company: 'Doha Front Desk', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Reception', salary: 'QAR 1.5k–4.5k/mo', desc: 'Hotel and clinic receptionist openings.' },
  { title: 'General Labour', company: 'Qatar Site Labour', code: 'QA', name: 'Qatar', city: 'Al Rayyan', category: 'Labour', salary: 'QAR 1k–3k/mo', desc: 'Construction and camp general labour.' },
  { title: 'Heavy Machinery Driver', company: 'Qatar Heavy Ops', code: 'QA', name: 'Qatar', city: 'Doha', category: 'Driving', salary: 'QAR 2k–6k/mo', desc: 'Heavy machinery and plant operators.' },

  { title: 'Cook', company: 'Poland Kitchen Hire', code: 'PL', name: 'Poland', city: 'Warsaw', category: 'Hospitality', salary: 'PLN 2k–5.5k/mo', desc: 'Cook roles in restaurants and hotels.' },
  { title: 'Driver', company: 'Polska Road Services', code: 'PL', name: 'Poland', city: 'Kraków', category: 'Driving', salary: 'PLN 2.2k–6k/mo', desc: 'Delivery and company driver positions.' },
  { title: 'Female Nurse / Caregiver', company: 'Warsaw Care Team', code: 'PL', name: 'Poland', city: 'Warsaw', category: 'Healthcare', salary: 'PLN 2.5k–6.5k/mo', desc: 'Female nurse and elderly care roles.' },
  { title: 'Female Child Care Taker', company: 'Kraków Kids Care', code: 'PL', name: 'Poland', city: 'Kraków', category: 'Care', salary: 'PLN 2k–5k/mo', desc: 'Female childcare and babysitter roles.' },
  { title: 'Receptionist', company: 'Office Desk PL', code: 'PL', name: 'Poland', city: 'Wrocław', category: 'Reception', salary: 'PLN 2k–5k/mo', desc: 'Reception and admin front desk roles.' },
  { title: 'Factory / Warehouse Labour', company: 'PL Production Hire', code: 'PL', name: 'Poland', city: 'Gdańsk', category: 'Labour', salary: 'PLN 2k–5.5k/mo', desc: 'Factory and warehouse labour workers.' },
  { title: 'Heavy Machinery Driver', company: 'BuildPlant Poland', code: 'PL', name: 'Poland', city: 'Warsaw', category: 'Driving', salary: 'PLN 2.8k–7k/mo', desc: 'Construction machinery operators and drivers.' },
];

function seed(db) {
  const existingVisas = db.prepare('SELECT COUNT(*) as c FROM visas').get().c;
  if (existingVisas < VISA_DATA.length) {
    const insertVisa = db.prepare(`
      INSERT OR IGNORE INTO visas (country_code, country_name, flag_emoji, visa_type, category, price, processing_days, validity_days, entries, requirements, description, popular)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of VISA_DATA) {
      insertVisa.run(v.code, v.name, v.flag, v.type, v.category, v.price, v.processing, v.validity, v.entries, JSON.stringify(v.reqs), v.desc, v.popular);
    }
  }

  const existingJobs = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
  if (existingJobs < JOB_DATA.length) {
    const insertJob = db.prepare(`
      INSERT INTO jobs (title, company, country_code, country_name, city, category, salary_range, visa_support, description, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
    `);
    const findJob = db.prepare('SELECT id FROM jobs WHERE title = ? AND company = ? AND city = ?');
    for (const j of JOB_DATA) {
      if (!findJob.get(j.title, j.company, j.city)) {
        insertJob.run(j.title, j.company, j.code, j.name, j.city, j.category, j.salary, j.desc);
      }
    }
  }

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'NexoraGo2026!';
  db.prepare(`
    INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)
  `).run(adminUser, hashPassword(adminPass));

  const count = db.prepare('SELECT COUNT(*) as c FROM visas').get().c;
  const jobs = db.prepare('SELECT COUNT(*) as c FROM jobs').get().c;
  const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  console.log(`[DB] Seeded ${count} visas, ${jobs} jobs | applications stored: ${orders}`);
  console.log(`[DB] Admin login: ${adminUser} / (set ADMIN_PASS to change)`);
  const persistence = turso.hasTursoConfig()
    ? 'turso'
    : (IS_SERVERLESS ? `${platformLabel()}-ephemeral` : 'local-disk');
  console.log(`[DB] Persistence: ${persistence}`);
}


let _db = null;
let _initPromise = null;

async function initDb() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const t0 = Date.now();
    const wasmBinary = resolveWasm();
    const SQL = await initSqlJs({ wasmBinary });

    // Prefer tiny pre-seeded DB on serverless (avoids 100+ inserts on every cold start)
    let fileBytes = null;
    if (IS_SERVERLESS) {
      fileBytes = loadSeedBaseBytes();
    }
    if (!fileBytes && !(IS_SERVERLESS && turso.hasTursoConfig())) {
      fileBytes = await loadPersistentBytes();
    }

    const db = wrapSqlJs(SQL, fileBytes);
    _db = db;

    db.withBulk(() => {
      migrateIfNeeded(db);
      createSchema(db);
      // Only seed when preseed missing / incomplete
      const visas = db.prepare('SELECT COUNT(*) as c FROM visas').get()?.c || 0;
      if (visas < 10) seed(db);
      else {
        // Ensure admin user exists
        const adminUser = process.env.ADMIN_USER || 'admin';
        const adminPass = process.env.ADMIN_PASS || 'NexoraGo2026!';
        db.prepare('INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)')
          .run(adminUser, hashPassword(adminPass));
        console.log(`[DB] Preseed ready — visas:${visas} jobs:${db.prepare('SELECT COUNT(*) as c FROM jobs').get().c}`);
      }
    });

    // Turso pull with hard timeout so Vercel never hits FUNCTION_INVOCATION_TIMEOUT
    if (turso.hasTursoConfig()) {
      try {
        await withTimeout(
          (async () => {
            await turso.ensureSchema();
            await turso.pullAppsIntoDb(db);
          })(),
          4500,
          'Turso sync'
        );
      } catch (err) {
        console.error('[DB] Turso sync skipped:', err.message);
      }
    } else if (!IS_SERVERLESS) {
      console.warn('[DB] TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not set — apps may not survive redeploy');
      try {
        const backup = await appsStore.loadAppsBackup();
        if (backup) appsStore.restoreAppsIntoDb(db, backup);
      } catch (err) {
        console.error('[DB] apps restore failed:', err.message);
      }
    } else {
      console.warn('[DB] Turso not configured on serverless — set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN');
    }

    // Never block cold start on Turso push
    await db.flushPersist({ pushTurso: false });
    const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    console.log(`[DB] Ready — applications: ${orders} (backend: ${turso.hasTursoConfig() ? 'turso' : 'local/blobs'}) in ${Date.now() - t0}ms`);
    return _db;
  })();

  try {
    return await _initPromise;
  } catch (err) {
    _initPromise = null;
    throw err;
  }
}

function getDb() {
  if (!_db) throw new Error('Database not initialized — call initDb() first');
  return _db;
}

const dbProxy = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'initDb') return initDb;
    if (prop === 'getDb') return getDb;
    if (prop === 'flushPersist') {
      return (opts) => (_db ? _db.flushPersist(opts) : Promise.resolve());
    }    return getDb()[prop];
  },
});

module.exports = dbProxy;
module.exports.initDb = initDb;
module.exports.getDb = getDb;
module.exports.flushPersist = (opts) => (_db ? _db.flushPersist(opts) : Promise.resolve());
