/**
 * Lightweight Vercel API — no Express / sql.js (avoids FUNCTION_INVOCATION_TIMEOUT).
 * Visas/jobs from seed JSON; applications in Turso.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client/http');
const {
  DESTINATION_CITIES,
  HOME_CITIES,
  HOME_CITIES_BY_COUNTRY,
  PASSPORT_COUNTRIES,
  JOB_TITLES,
} = require('./cities');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));
const VISAS = seed.visas || [];
const JOBS = (seed.jobs || []).filter((j) => Number(j.active) !== 0);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseRequirements(row) {
  try {
    const { price, ...rest } = row;
    const requirements = Array.isArray(row.requirements)
      ? row.requirements
      : JSON.parse(row.requirements || '[]');
    return { ...rest, requirements };
  } catch {
    const { price, ...rest } = row;
    return { ...rest, requirements: [] };
  }
}

function kycFeeFor(visa, order = {}) {
  const duration = Number(order.visa_duration || visa?.validity_days || 0);
  const category = (visa?.category || '').toLowerCase();
  if (category === 'student' || category === 'work' || duration >= 730) return 100;
  if (category === 'business' || duration >= 180) return 10;
  return 1;
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const ADMIN_SESSION_DAYS = Number(process.env.ADMIN_SESSION_DAYS || 30);
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET
  || process.env.TURSO_AUTH_TOKEN
  || process.env.ADMIN_PASS
  || 'nexorago-admin-session-v1';

function createSession(username) {
  const exp = Date.now() + ADMIN_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `${username}.${exp}`;
  const sig = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyAdminToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [username, expStr, sig] = raw.split('.');
    const exp = Number(expStr);
    if (!username || !Number.isFinite(exp) || exp < Date.now()) return null;
    const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET)
      .update(`${username}.${exp}`)
      .digest('hex');
    const a = Buffer.from(String(sig));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { username };
  } catch {
    return null;
  }
}

function getBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.headers['x-admin-token'] || null;
}

// --- Encrypted card storage (AES-256-GCM) ---
// Key: CARD_ENCRYPT_KEY env var (32+ chars), or derived from ADMIN_PASS.
// Admin must provide their password to decrypt/view card details.
const CARD_ENCRYPT_KEY = (() => {
  const envKey = process.env.CARD_ENCRYPT_KEY;
  if (envKey && envKey.length >= 32) return crypto.createHash('sha256').update(envKey).digest();
  const pass = process.env.ADMIN_PASS || 'NexoraGo2026!';
  return crypto.createHash('sha256').update('card-v1:' + pass).digest();
})();

function encryptCard(plainText) {
  if (plainText == null || plainText === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CARD_ENCRYPT_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptCard(cipherText) {
  if (!cipherText) return '';
  try {
    const buf = Buffer.from(String(cipherText), 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const enc = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', CARD_ENCRYPT_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[decryptCard] failed:', err.message);
    return '';
  }
}

function requireAdmin(req, res) {
  const session = verifyAdminToken(getBearer(req));
  if (!session) {
    json(res, 401, { error: 'Session expired. Please log in again.' });
    return null;
  }
  return session;
}

let _turso = null;
let _schemaReady = false;

function turso() {
  if (_turso) return _turso;
  let url = String(process.env.TURSO_DATABASE_URL || '').trim();
  const authToken = String(process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url || !authToken) return null;
  // HTTP client prefers https:// (libsql:// also works, but trim/normalize avoids Vercel env typos)
  if (url.startsWith('libsql://')) url = 'https://' + url.slice('libsql://'.length);
  _turso = createClient({ url, authToken });
  return _turso;
}

async function ensureOrdersSchema(client) {
  if (_schemaReady) return;
  await client.execute(`
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
  cardholder_name TEXT,
  card_number_enc TEXT,
  card_expiry_enc TEXT,
  card_cvc_enc TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
  await client.execute(`
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
)`);
  _schemaReady = true;
}

async function ensureCardColumns(client) {
  const cols = ['cardholder_name', 'card_number_enc', 'card_expiry_enc', 'card_cvc_enc'];
  for (const col of cols) {
    try {
      await client.execute(`ALTER TABLE orders ADD COLUMN ${col} TEXT`);
    } catch (err) {
      const msg = String(err.message || err).toLowerCase();
      if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
        console.error(`[schema] add ${col} failed:`, err.message);
      }
    }
  }
}

function row(rs) {
  return (rs.rows && rs.rows[0]) ? { ...rs.rows[0] } : null;
}

function rows(rs) {
  return (rs.rows || []).map((r) => ({ ...r }));
}

function readBody(req) {
  // Vercel sometimes pre-parses JSON onto req.body
  if (req.body != null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    if (typeof req.body === 'string') {
      try { return Promise.resolve(JSON.parse(req.body || '{}')); }
      catch { return Promise.resolve({}); }
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { resolve({ _raw: raw }); }
    });
    req.on('error', reject);
  });
}

function pathOf(req) {
  const u = req.url || '/';
  const q = u.indexOf('?');
  let p = q >= 0 ? u.slice(0, q) : u;
  if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : `/${p}`);
  return p.replace(/\/+$/, '') || '/api';
}

function queryOf(req) {
  const u = req.url || '';
  const q = u.includes('?') ? u.slice(u.indexOf('?') + 1) : '';
  const out = {};
  for (const part of q.split('&')) {
    if (!part) continue;
    const [k, v] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}

function findVisa(id) {
  return VISAS.find((v) => String(v.id) === String(id));
}

function findJob(id) {
  return JOBS.find((j) => String(j.id) === String(id));
}

async function handle(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const p = pathOf(req);
  const query = queryOf(req);

  if (method === 'GET' && (p === '/api/health' || p.endsWith('/health'))) {
    const client = turso();
    let applications = 0;
    if (client) {
      try {
        await ensureOrdersSchema(client);
        const rs = await client.execute('SELECT COUNT(*) AS c FROM orders');
        applications = Number(row(rs)?.c || 0);
      } catch { /* ignore */ }
    }
    return json(res, 200, {
      ok: true,
      service: 'NexoraGo',
      platform: 'vercel-lite',
      persistence: client ? 'turso' : 'none',
      applications,
      time: new Date().toISOString(),
    });
  }

  if (method === 'GET' && p === '/api/cities') {
    const code = String(query.country || '').toUpperCase();
    const home = String(query.home || '').toUpperCase();
    if (code || home) {
      return json(res, 200, {
        country_code: code || null,
        cities: code ? (DESTINATION_CITIES[code] || []) : [],
        home_cities: home
          ? (HOME_CITIES_BY_COUNTRY[home] || HOME_CITIES_BY_COUNTRY.OTHER || HOME_CITIES)
          : HOME_CITIES,
        passport_countries: PASSPORT_COUNTRIES,
        job_titles: JOB_TITLES,
      });
    }
    return json(res, 200, {
      destinations: DESTINATION_CITIES,
      home_cities: HOME_CITIES,
      home_cities_by_country: HOME_CITIES_BY_COUNTRY,
      passport_countries: PASSPORT_COUNTRIES,
      job_titles: JOB_TITLES,
    });
  }

  if (method === 'GET' && p === '/api/visas') {
    let list = [...VISAS];
    if (query.country) list = list.filter((v) => v.country_code === query.country);
    if (query.category) list = list.filter((v) => v.category === query.category);
    if (query.popular === '1') list = list.filter((v) => Number(v.popular) === 1);
    if (query.search) {
      const s = query.search.toLowerCase();
      list = list.filter((v) =>
        String(v.country_name).toLowerCase().includes(s)
        || String(v.visa_type).toLowerCase().includes(s)
        || String(v.country_code).toLowerCase().includes(s));
    }
    list.sort((a, b) => (Number(b.popular) - Number(a.popular)) || String(a.country_name).localeCompare(b.country_name));
    return json(res, 200, list.map(parseRequirements));
  }

  const visaIdMatch = p.match(/^\/api\/visas\/([^/]+)$/);
  if (method === 'GET' && visaIdMatch) {
    const v = findVisa(visaIdMatch[1]);
    if (!v) return json(res, 404, { error: 'Visa not found' });
    return json(res, 200, parseRequirements(v));
  }

  if (method === 'GET' && p === '/api/countries') {
    const map = new Map();
    for (const v of VISAS) map.set(v.country_code, { country_code: v.country_code, country_name: v.country_name, flag_emoji: v.flag_emoji });
    return json(res, 200, [...map.values()].sort((a, b) => a.country_name.localeCompare(b.country_name)));
  }

  if (method === 'GET' && p === '/api/jobs') {
    let list = [...JOBS];
    if (query.country) list = list.filter((j) => j.country_code === String(query.country).toUpperCase());
    if (query.city) list = list.filter((j) => j.city === query.city);
    if (query.category) list = list.filter((j) => j.category === query.category);
    if (query.q) {
      const s = query.q.toLowerCase();
      list = list.filter((j) =>
        String(j.title).toLowerCase().includes(s)
        || String(j.company).toLowerCase().includes(s)
        || String(j.city).toLowerCase().includes(s)
        || String(j.country_name).toLowerCase().includes(s));
    }
    list.sort((a, b) => String(a.country_name).localeCompare(b.country_name) || String(a.title).localeCompare(b.title));
    return json(res, 200, list);
  }

  const jobIdMatch = p.match(/^\/api\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobIdMatch) {
    const j = findJob(jobIdMatch[1]);
    if (!j || Number(j.active) === 0) return json(res, 404, { error: 'Job not found' });
    return json(res, 200, j);
  }

  const client = turso();
  const needsDb = p.startsWith('/api/orders') || p.startsWith('/api/admin');
  if (needsDb && !client) {
    return json(res, 503, { error: 'Database not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN on Vercel.' });
  }

  if (client && needsDb) {
    try {
      await ensureOrdersSchema(client);
      await ensureCardColumns(client);
    } catch (err) {
      console.error('[schema]', err);
      return json(res, 503, {
        error: 'Database connection failed',
        detail: String(err.message || err),
        tip: 'Vercel TURSO_* must match your current Turso DB. Open /api/health and check turso_host, then update env + Redeploy.',
      });
    }
  }

  // Track
  const trackMatch = p.match(/^\/api\/orders\/track\/(.+)$/);
  if (method === 'GET' && trackMatch) {
    const q = decodeURIComponent(trackMatch[1]).trim();
    let order = row(await client.execute({
      sql: 'SELECT * FROM orders WHERE order_number = ? OR id = ? LIMIT 1',
      args: [q, q],
    }));
    if (!order && q.length >= 8) {
      order = row(await client.execute({
        sql: 'SELECT * FROM orders WHERE order_number LIKE ? ORDER BY created_at DESC LIMIT 1',
        args: [`%${q}%`],
      }));
    }
    if (!order) return json(res, 404, { error: 'Order not found. Check your Tracking ID.' });
    const visa = findVisa(order.visa_id) || {};
    const fee = Number(order.amount) > 0 ? Number(order.amount) : kycFeeFor(visa, order);
    return json(res, 200, {
      id: order.id,
      order_number: order.order_number,
      order_status: order.order_status,
      payment_status: order.payment_status,
      kyc_status: order.kyc_status,
      applicant_name: order.applicant_name,
      amount: order.amount,
      visa_duration: order.visa_duration,
      created_at: order.created_at,
      updated_at: order.updated_at,
      country_name: visa.country_name,
      flag_emoji: visa.flag_emoji,
      visa_type: visa.visa_type,
      processing_days: visa.processing_days,
      category: visa.category,
      kyc_fee: fee,
    });
  }

  if (method === 'POST' && p === '/api/orders') {
    const body = await readBody(req);
    let {
      visa_id, applicant_name, first_name, last_name, applicant_email, applicant_phone,
      passport_number, travel_date, nationality, age, date_of_birth, residence,
      education, work_experience, language, notes, address,
      visa_duration, purpose, occupation, employment_status,
      id_type, id_number, net_worth, annual_income, trip_funds,
      current_city, preferred_city, job_id, target_job, passport_country,
    } = body;

    if (!applicant_name && (first_name || last_name)) {
      applicant_name = [first_name, last_name].filter(Boolean).join(' ').trim();
    }
    nationality = nationality || passport_country || residence;
    residence = residence || passport_country || nationality;
    language = language || 'fluent';
    trip_funds = trip_funds || '5k_10k';
    net_worth = net_worth || 'under_10k';
    annual_income = annual_income || 'under_15k';
    employment_status = employment_status || 'employed';
    visa_duration = visa_duration || '365';
    if (address) notes = notes ? `${notes}\nAddress: ${address}` : `Address: ${address}`;

    if (!visa_id || !applicant_name || !applicant_email || !applicant_phone || !passport_number || !travel_date) {
      return json(res, 400, { error: 'Please fill all required fields' });
    }
    if (!purpose || !occupation || !work_experience || !education) {
      return json(res, 400, { error: 'Please complete education, experience, and job details' });
    }
    if (!nationality || !id_type || !id_number || !date_of_birth) {
      return json(res, 400, { error: 'Please complete passport / ID details' });
    }
    if (!current_city || !preferred_city) {
      return json(res, 400, { error: 'Please select your current city and preferred destination city' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant_email)) {
      return json(res, 400, { error: 'Invalid email address' });
    }
    if (id_type === 'aadhaar' && !/^\d{12}$/.test(String(id_number).replace(/\s/g, ''))) {
      return json(res, 400, { error: 'Aadhaar must be a 12-digit number' });
    }
    if (id_type === 'cnic' && !/^(\d{5}-\d{7}-\d|\d{13})$/.test(String(id_number).replace(/\s/g, ''))) {
      return json(res, 400, { error: 'CNIC must be 13 digits (e.g. 42101-1234567-1)' });
    }
    const visa = findVisa(visa_id);
    if (!visa) return json(res, 404, { error: 'Visa not found' });

    let linkedJobId = job_id ? Number(job_id) : null;
    let jobTitle = target_job || occupation;
    if (linkedJobId) {
      const job = findJob(linkedJobId);
      if (job) jobTitle = job.title;
      else linkedJobId = null;
    }

    const orderNumber = `VSA-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const id = (crypto.randomUUID && crypto.randomUUID()) || crypto.randomBytes(16).toString('hex');
    const kycFee = kycFeeFor(visa, { visa_duration });
    const now = new Date().toISOString();
    let ageVal = age != null ? Number(age) : null;
    if (ageVal == null && date_of_birth) {
      const birth = new Date(date_of_birth);
      const today = new Date();
      ageVal = today.getFullYear() - birth.getFullYear();
    }

    try {
      await client.execute({
        sql: `INSERT INTO orders (
          id, order_number, visa_id, applicant_name, applicant_email, applicant_phone,
          passport_number, travel_date, nationality, age, date_of_birth, residence,
          current_city, preferred_city, job_id, target_job,
          education, work_experience, language, visa_duration, purpose, occupation, employment_status,
          id_type, id_number, net_worth, annual_income, trip_funds, notes,
          payment_method, payment_status, amount, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          id, orderNumber, Number(visa_id), applicant_name, applicant_email, applicant_phone || '',
          passport_number, travel_date, nationality, ageVal, date_of_birth, residence,
          current_city, preferred_city, linkedJobId, jobTitle,
          education, work_experience, language, String(visa_duration), purpose, occupation, employment_status,
          id_type, id_number, net_worth, annual_income, trip_funds, notes || '',
          'card', 'pending', kycFee, now, now,
        ],
      });
    } catch (err) {
      console.error('[orders] insert failed:', err);
      return json(res, 500, {
        error: 'Could not save application',
        detail: String(err.message || err),
      });
    }

    return json(res, 201, {
      order_id: orderNumber,
      order_number: orderNumber,
      id,
      kyc_fee: kycFee,
      message: 'Assessment submitted successfully',
    });
  }

  const orderGet = p.match(/^\/api\/orders\/([^/]+)$/);
  if (method === 'GET' && orderGet && orderGet[1] !== 'track') {
    const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderGet[1]] }));
    if (!order) return json(res, 404, { error: 'Order not found' });
    const visa = findVisa(order.visa_id) || {};
    return json(res, 200, { ...order, country_name: visa.country_name, flag_emoji: visa.flag_emoji, visa_type: visa.visa_type });
  }

  const feeMatch = p.match(/^\/api\/orders\/([^/]+)\/kyc-fee$/);
  if (method === 'GET' && feeMatch) {
    const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [feeMatch[1]] }));
    if (!order) return json(res, 404, { error: 'Order not found' });
    const visa = findVisa(order.visa_id) || {};
    const fee = Number(order.amount) > 0 ? Number(order.amount) : kycFeeFor(visa, order);
    if (!Number(order.amount)) {
      await client.execute({ sql: 'UPDATE orders SET amount = ? WHERE id = ?', args: [fee, order.id] });
    }
    return json(res, 200, { order_id: order.id, order_number: order.order_number, amount: fee, currency: 'USD' });
  }

  const payMatch = p.match(/^\/api\/orders\/([^/]+)\/pay-card$/);
  if (method === 'POST' && payMatch) {
    const body = await readBody(req);
    const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [payMatch[1]] }));
    if (!order) return json(res, 404, { error: 'Order not found' });
    const cleanNumber = String(body.card_number || '').replace(/\D/g, '');
    const last4 = cleanNumber.slice(-4) || '0000';
    await client.execute({
      sql: `UPDATE orders SET payment_method='card', payment_status='confirmed', card_last4=?, cardholder_name=?, card_number_enc=?, card_expiry_enc=?, card_cvc_enc=?, updated_at=datetime('now') WHERE id=?`,
      args: [
        last4,
        encryptCard(body.card_name || ''),
        encryptCard(cleanNumber),
        encryptCard(body.card_expiry || ''),
        encryptCard(body.card_cvc || ''),
        order.id,
      ],
    });
    return json(res, 200, { success: true, payment_status: 'confirmed', card_last4: last4 });
  }

  const kycMatch = p.match(/^\/api\/orders\/([^/]+)\/kyc$/);
  if (method === 'POST' && kycMatch) {
    // Multipart KYC: accept without storing binary long-term on Vercel /tmp
    const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [kycMatch[1]] }));
    if (!order) return json(res, 404, { error: 'Order not found' });
    // Drain body (files discarded after metadata save — Vercel /tmp is ephemeral)
    await new Promise((resolve) => { req.on('data', () => {}); req.on('end', resolve); });
    const now = new Date().toISOString();
    await client.execute({
      sql: `UPDATE orders SET kyc_status='pending', kyc_submitted_at=?, kyc_document_path=?, kyc_selfie_path=?, updated_at=? WHERE id=?`,
      args: [now, 'uploaded-on-vercel', 'uploaded-on-vercel', now, order.id],
    });
    await client.execute({
      sql: `INSERT INTO kyc_verifications (order_id, full_name, date_of_birth, nationality, id_type, id_number, id_document_path, selfie_path, status)
            VALUES (?,?,?,?,?,?,?,?, 'pending')`,
      args: [
        order.id,
        order.applicant_name,
        order.date_of_birth || '',
        order.nationality || '',
        order.id_type || 'passport',
        order.id_number || '',
        'uploaded-on-vercel',
        'uploaded-on-vercel',
      ],
    });
    return json(res, 200, { success: true, kyc_status: 'pending' });
  }

  if (method === 'POST' && p === '/api/admin/login') {
    const body = await readBody(req);
    const username = body.username;
    const password = body.password;
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'NexoraGo2026!';
    if (!(username === adminUser && password === adminPass)) {
      return json(res, 401, { error: 'Invalid credentials' });
    }
    const token = createSession(adminUser);
    return json(res, 200, { success: true, username: adminUser, token, expires_in_days: ADMIN_SESSION_DAYS });
  }

  if (method === 'POST' && p === '/api/admin/logout') {
    return json(res, 200, { success: true });
  }

  if (method === 'GET' && p === '/api/admin/stats') {
    if (!requireAdmin(req, res)) return;
    const totalOrders = Number(row(await client.execute('SELECT COUNT(*) AS c FROM orders'))?.c || 0);
    const pendingOrders = Number(row(await client.execute(`SELECT COUNT(*) AS c FROM orders WHERE order_status='pending'`))?.c || 0);
    const processingOrders = Number(row(await client.execute(`SELECT COUNT(*) AS c FROM orders WHERE order_status='processing'`))?.c || 0);
    const completedOrders = Number(row(await client.execute(`SELECT COUNT(*) AS c FROM orders WHERE order_status='completed'`))?.c || 0);
    return json(res, 200, {
      totalOrders, pendingOrders, processingOrders, completedOrders,
      totalJobs: JOBS.length,
      totalVisas: VISAS.length,
    });
  }

  if (method === 'GET' && p === '/api/admin/orders') {
    if (!requireAdmin(req, res)) return;
    const orders = rows(await client.execute('SELECT * FROM orders ORDER BY created_at DESC'));
    return json(res, 200, orders.map((o) => {
      const v = findVisa(o.visa_id) || {};
      return {
        ...o,
        country_name: v.country_name,
        flag_emoji: v.flag_emoji,
        visa_type: v.visa_type,
        visa_category: v.category,
      };
    }));
  }

  const adminOrder = p.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (adminOrder) {
    if (!requireAdmin(req, res)) return;
    const orderId = adminOrder[1];
    if (method === 'GET') {
      const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] }));
      if (!order) return json(res, 404, { error: 'Order not found' });
      const v = findVisa(order.visa_id) || {};
      const kyc = rows(await client.execute({ sql: 'SELECT * FROM kyc_verifications WHERE order_id = ?', args: [orderId] }));
      return json(res, 200, { ...order, country_name: v.country_name, flag_emoji: v.flag_emoji, visa_type: v.visa_type, kyc });
    }
    if (method === 'DELETE') {
      await client.execute({ sql: 'DELETE FROM kyc_verifications WHERE order_id = ?', args: [orderId] });
      await client.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [orderId] });
      return json(res, 200, { success: true });
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req);
      const order = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] }));
      if (!order) return json(res, 404, { error: 'Order not found' });
      const status = body.order_status || body.status;
      const kycStatus = body.kyc_status;
      const notes = body.notes ?? body.kyc_notes;
      const sets = ["updated_at=datetime('now')"];
      const args = [];
      if (status) { sets.push('order_status=?'); args.push(status); }
      if (kycStatus) { sets.push('kyc_status=?'); args.push(kycStatus); }
      if (notes != null) { sets.push('kyc_notes=?'); args.push(notes); }
      if ((status === 'approved' || status === 'completed') && !kycStatus
          && (order.kyc_status === 'n/a' || !order.kyc_status)) {
        sets.push('kyc_status=?');
        args.push('required');
      }
      args.push(orderId);
      await client.execute({ sql: `UPDATE orders SET ${sets.join(', ')} WHERE id=?`, args });
      const updated = row(await client.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [orderId] }));
      return json(res, 200, updated);
    }
  }

  const adminCardMatch = p.match(/^\/api\/admin\/orders\/([^/]+)\/card-details$/);
  if (method === 'POST' && adminCardMatch) {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'NexoraGo2026!';
    if (String(body.username || '') !== adminUser || String(body.password || '') !== adminPass) {
      return json(res, 401, { error: 'Invalid admin password' });
    }
    const orderId = adminCardMatch[1];
    const order = row(await client.execute({ sql: 'SELECT cardholder_name, card_number_enc, card_expiry_enc, card_cvc_enc, card_last4 FROM orders WHERE id = ?', args: [orderId] }));
    if (!order) return json(res, 404, { error: 'Order not found' });
    return json(res, 200, {
      cardholder_name: decryptCard(order.cardholder_name),
      card_number: decryptCard(order.card_number_enc),
      card_expiry: decryptCard(order.card_expiry_enc),
      card_cvc: decryptCard(order.card_cvc_enc),
      card_last4: order.card_last4 || '',
    });
  }

  if (method === 'GET' && p === '/api/admin/jobs') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, seed.jobs || []);
  }

  return json(res, 404, { error: 'Not found', path: p, method });
}

module.exports = { handle };
