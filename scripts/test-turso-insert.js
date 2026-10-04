const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
const { createClient } = require('@libsql/client/http');

let url = String(process.env.TURSO_DATABASE_URL || '').trim();
const authToken = String(process.env.TURSO_AUTH_TOKEN || '').trim();
if (url.startsWith('libsql://')) url = 'https://' + url.slice('libsql://'.length);

console.log('url', url);
console.log('token len', authToken.length);

const c = createClient({ url, authToken });

(async () => {
  try {
    await c.execute(`
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
)`);
    console.log('schema ok');

    const id = 'test-' + Date.now();
    const on = 'VSA-TEST-' + Date.now();
    await c.execute({
      sql: `INSERT INTO orders (
        id, order_number, visa_id, applicant_name, applicant_email, applicant_phone,
        passport_number, travel_date, nationality, age, date_of_birth, residence,
        current_city, preferred_city, job_id, target_job,
        education, work_experience, language, visa_duration, purpose, occupation, employment_status,
        id_type, id_number, net_worth, annual_income, trip_funds, notes,
        payment_method, payment_status, amount, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, on, 1, 'Test User', 't@example.com', '+100',
        'P123', '2026-12-01', 'India', 30, '1995-01-01', 'India',
        'Mumbai', 'Dubai', null, 'Driver',
        'High School', '3 years', 'English', '1', 'Work', 'Driver', 'Employed',
        'aadhaar', '1234', '', '', '', '',
        'card', 'pending', 99, new Date().toISOString(), new Date().toISOString(),
      ],
    });
    console.log('insert ok', on);
    await c.execute({ sql: 'DELETE FROM orders WHERE id = ?', args: [id] });
    console.log('cleanup ok');
  } catch (e) {
    console.error('FAIL', e.message, e);
    process.exit(1);
  }
})();
