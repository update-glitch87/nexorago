// ── State ──
let currentVisa = null;
let currentOrder = null;
let lastApplicantSnapshot = null;
let lastAdminOrder = null;
let lastTicketKind = 'payment';
let bankReviewTimer = null;
let bankReviewTick = null;
let formStep = 1;
let adminToken = localStorage.getItem('nexorago_admin_token') || null;
let applicantToken = localStorage.getItem('nexorago_applicant_token') || null;
let applicantUser = null;
try { applicantUser = JSON.parse(localStorage.getItem('nexorago_applicant_user') || 'null'); } catch { applicantUser = null; }
let pendingApplyAfterAuth = null;
const ADMIN_SECRET_PATH = '/admin82832783';
let adminGateOk = sessionStorage.getItem('nexorago_admin_gate') === '1';

function isAdminSecretPath() {
  const path = (window.location.pathname || '').replace(/\/+$/, '') || '/';
  return path === ADMIN_SECRET_PATH || path.endsWith(ADMIN_SECRET_PATH);
}

function unlockAdminGate() {
  adminGateOk = true;
  sessionStorage.setItem('nexorago_admin_gate', '1');
}

function showView(viewName) {
  if (viewName === 'admin' && !adminGateOk && !isAdminSecretPath()) {
    showToast('Admin is not available here', 'error');
    return;
  }
  if (viewName === 'admin') unlockAdminGate();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${viewName}`);
  if (view) view.classList.add('active');
  window.scrollTo(0, 0);

  closeNav();

  if (viewName === 'home') {
    loadPopularVisas();
    loadHomeJobs();
  }
  if (viewName === 'account') refreshAccountView();
  if (viewName === 'track') {
    const input = document.getElementById('track-order-id');
    const last = localStorage.getItem('nexorago_last_ref');
    if (input && last && !input.value) input.value = last;
  }
  if (viewName === 'visas') loadAllVisas();
  if (viewName === 'jobs') loadAllJobs();
  if (viewName === 'admin') {
    if (adminToken) {
      document.getElementById('admin-login').style.display = 'none';
      document.getElementById('admin-dashboard').style.display = 'block';
      loadAdminDashboard();
    } else {
      document.getElementById('admin-login').style.display = 'block';
      document.getElementById('admin-dashboard').style.display = 'none';
    }
  }
}

function closeNav() {
  const navLinks = document.getElementById('navLinks');
  if (navLinks) navLinks.classList.remove('open');
  document.body.classList.remove('nav-open');
}

function toggleNav() {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;
  navLinks.classList.toggle('open');
  document.body.classList.toggle('nav-open', navLinks.classList.contains('open'));
}

async function api(url, options = {}) {
  const opts = { ...options };
  const silent = !!opts.silent;
  delete opts.silent;
  const headers = { ...(options.headers || {}) };
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (!isFormData && !headers['Content-Type'] && opts.body) {
    headers['Content-Type'] = 'application/json';
  }
  const isAdminUrl = url.includes('/api/admin');
  if (isAdminUrl && adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  } else if (applicantToken && (url.includes('/api/auth') || url.includes('/api/orders'))) {
    headers.Authorization = `Bearer ${applicantToken}`;
  } else if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }
  opts.headers = headers;

  try {
    const res = await fetch(url, opts);
    let data = {};
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch {
      data = { error: text?.slice(0, 120) || `Request failed (${res.status})` };
    }

    if (!res.ok) {
      if (res.status === 401 && url.includes('/api/admin/') && !url.includes('/login')) {
        adminToken = null;
        localStorage.removeItem('nexorago_admin_token');
      }
      if (res.status === 401 && (url.includes('/api/auth/me') || url === '/api/orders' || url.startsWith('/api/orders?'))) {
        clearApplicantSession(false);
      }
      const msg = data.error || data.detail || `Request failed (${res.status})`;
      const full = data.detail && data.error && data.detail !== data.error
        ? `${data.error}: ${data.detail}`
        : (typeof msg === 'string' ? msg : 'Request failed');
      throw new Error(full);
    }
    return data;
  } catch (err) {
    if (!silent) {
      const message = err.message === 'Failed to fetch'
        ? 'Cannot reach API — check Netlify function deploy'
        : err.message;
      showToast(message, 'error');
    }
    throw err;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, ' ');
}

/** Open WhatsApp outside the webview/APK (native WhatsApp via wa.me) */
function openWhatsApp(phone, event) {
  if (event) event.preventDefault();
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return false;
  const msg = encodeURIComponent('Hi NexoraGo, I need help with jobs / visa.');
  const url = `https://wa.me/${digits}?text=${msg}`;
  // Opens outside the site / WebView into WhatsApp when installed
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) window.location.href = url;
  return false;
}

function toggleWaFloat() {
  const menu = document.getElementById('wa-float-menu');
  if (!menu) return;
  menu.hidden = !menu.hidden;
}

async function loadPopularVisas() {
  try {
    const visas = await api('/api/visas?popular=1');
    document.getElementById('popular-visas').innerHTML = visas.map(v => visaCardHTML(v)).join('');
    refreshCardEffects();
  } catch (e) { /* handled */ }
}

async function loadAllVisas() {
  try {
    const visas = await api('/api/visas');
    document.getElementById('all-visas').innerHTML = visas.map(v => visaCardHTML(v)).join('');
    const countries = [...new Map(visas.map(v => [v.country_code, v])).values()]
      .sort((a, b) => a.country_name.localeCompare(b.country_name));
    document.getElementById('filter-country').innerHTML =
      '<option value="">All Countries</option>' +
      countries.map(c => `<option value="${escapeHtml(c.country_code)}">${c.flag_emoji} ${escapeHtml(c.country_name)}</option>`).join('');
    refreshCardEffects();
  } catch (e) { /* handled */ }
}

async function filterVisas() {
  const params = new URLSearchParams();
  const search = document.getElementById('search-input').value;
  const category = document.getElementById('filter-category').value;
  const country = document.getElementById('filter-country').value;
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (country) params.set('country', country);

  try {
    const visas = await api(`/api/visas?${params}`);
    document.getElementById('all-visas').innerHTML = visas.length
      ? visas.map(v => visaCardHTML(v)).join('')
      : '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No visas found.</p>';
    refreshCardEffects();
  } catch (e) { /* handled */ }
}

function visaCardHTML(v) {
  const cat = (v.category || '').charAt(0).toUpperCase() + (v.category || '').slice(1);
  return `
    <div class="visa-card" onclick="startFromCard(${Number(v.id)})">
      <div class="visa-card-header">
        <span class="visa-flag">${v.flag_emoji}</span>
        <div class="visa-card-title">
          <h3>${escapeHtml(v.country_name)}</h3>
          <span>${escapeHtml(v.visa_type)}</span>
        </div>
      </div>
      <div class="visa-card-body">
        <p>${escapeHtml(v.description)}</p>
        <div class="visa-card-footer">
          <div class="visa-meta">
            <span class="visa-tag">${escapeHtml(cat)}</span>
            <span>⏱ ${Number(v.processing_days)} days</span>
          </div>
          <span class="visa-cta">Select →</span>
        </div>
      </div>
    </div>
  `;
}

async function startFromCard(id) {
  try {
    currentVisa = await api(`/api/visas/${id}`);
    startApplication(currentVisa.id);
  } catch (e) { /* handled */ }
}

let allJobsCache = [];
let pendingJobId = null;

function jobCardHTML(j) {
  return `
    <div class="job-card">
      <div class="job-card-top">
        <h3>${escapeHtml(j.title)}</h3>
        <span class="job-tag">${escapeHtml(j.category)}</span>
      </div>
      <p class="job-company">${escapeHtml(j.company)}</p>
      <p class="job-loc">${escapeHtml(j.country_name)} · ${escapeHtml(j.city)}</p>
      <p class="job-salary">${escapeHtml(j.salary_range || 'Competitive')}</p>
      <p class="job-desc">${escapeHtml(j.description)}</p>
      <div class="job-card-actions">
        <span class="visa-tag">${j.visa_support ? 'Visa support' : 'Check visa'}</span>
        <button type="button" class="btn btn-sm btn-primary" onclick="applyForJob(${Number(j.id)})">Apply →</button>
      </div>
    </div>
  `;
}

async function loadHomeJobs() {
  try {
    const jobs = await api('/api/jobs');
    allJobsCache = jobs;
    const el = document.getElementById('home-jobs');
    if (el) el.innerHTML = jobs.slice(0, 6).map(jobCardHTML).join('');
  } catch (e) { /* handled */ }
}

async function loadAllJobs() {
  try {
    const jobs = await api('/api/jobs');
    allJobsCache = jobs;
    const countries = [...new Map(jobs.map(j => [j.country_code, j])).values()]
      .sort((a, b) => a.country_name.localeCompare(b.country_name));
    const sel = document.getElementById('job-filter-country');
    if (sel) {
      sel.innerHTML = '<option value="">All Countries</option>' +
        countries.map(c => `<option value="${escapeHtml(c.country_code)}">${escapeHtml(c.country_name)}</option>`).join('');
    }
    renderJobs(jobs);
  } catch (e) { /* handled */ }
}

function renderJobs(jobs) {
  const el = document.getElementById('all-jobs');
  if (!el) return;
  el.innerHTML = jobs.length
    ? jobs.map(jobCardHTML).join('')
    : '<p style="text-align:center;color:var(--text-muted);padding:2rem;">No jobs found.</p>';
}

function filterJobs() {
  const q = (document.getElementById('job-search')?.value || '').toLowerCase();
  const country = document.getElementById('job-filter-country')?.value || '';
  const category = document.getElementById('job-filter-category')?.value || '';
  const filtered = allJobsCache.filter(j => {
    if (country && j.country_code !== country) return false;
    if (category && j.category !== category) return false;
    if (q) {
      const hay = `${j.title} ${j.company} ${j.city} ${j.country_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderJobs(filtered);
}

async function applyForJob(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    pendingJobId = job.id;
    // pick a matching work visa for that country
    const visas = await api(`/api/visas?country=${encodeURIComponent(job.country_code)}&category=work`);
    const visa = visas[0] || (await api(`/api/visas?country=${encodeURIComponent(job.country_code)}`))[0];
    if (!visa) {
      showToast('No visa pathway found for this country', 'warning');
      return;
    }
    currentVisa = visa;
    startApplication(visa.id, job);
  } catch (e) { /* handled */ }
}

let passportCountriesCache = [];

async function prepareApplyForm(selectedJob = null) {
  try {
    const meta = await api(`/api/cities?country=${encodeURIComponent(currentVisa?.country_code || '')}`);
    passportCountriesCache = meta.passport_countries || [];

    const passSel = document.getElementById('passport-country');
    const currCountry = document.getElementById('current-country');
    const homeSel = document.getElementById('current-city');
    const prefSel = document.getElementById('preferred-city');
    const jobSel = document.getElementById('apply-job-id');
    const list = document.getElementById('job-title-list');
    const destDisp = document.getElementById('dest-country-display');

    if (destDisp && currentVisa) {
      destDisp.value = `${currentVisa.flag_emoji || ''} ${currentVisa.country_name}`.trim();
    }

    const countryOpts = '<option value="">Select country</option>' +
      passportCountriesCache.map((c) =>
        `<option value="${escapeHtml(c.name)}" data-code="${escapeHtml(c.code)}">${escapeHtml(c.flag || '')} ${escapeHtml(c.name)}</option>`
      ).join('');
    if (passSel) passSel.innerHTML = countryOpts;
    if (currCountry) currCountry.innerHTML = countryOpts;

    if (homeSel) {
      homeSel.innerHTML = '<option value="">Select city</option>' +
        (meta.home_cities || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    if (prefSel) {
      const cities = meta.cities || [];
      prefSel.innerHTML = '<option value="">Select city</option>' +
        cities.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
        '<option value="Other">Other</option>';
    }
    if (list) {
      list.innerHTML = (meta.job_titles || []).map((t) => `<option value="${escapeHtml(t)}"></option>`).join('');
    }

    const countryJobs = await api(`/api/jobs?country=${encodeURIComponent(currentVisa?.country_code || '')}`);
    if (jobSel) {
      jobSel.innerHTML = '<option value="">Custom / not listed</option>' +
        countryJobs.map((j) => `<option value="${j.id}">${escapeHtml(j.title)} — ${escapeHtml(j.city)}</option>`).join('');
    }

    // Default passport country Pakistan/India common
    if (passSel && !passSel.value) {
      const prefer = [...passSel.options].find((o) => /Pakistan|India/i.test(o.value));
      if (prefer) { passSel.value = prefer.value; onPassportCountryChange(); }
    }

    if (selectedJob) {
      if (jobSel) jobSel.value = String(selectedJob.id);
      const occ = document.getElementById('occupation-input');
      if (occ) occ.value = selectedJob.title;
      const tj = document.getElementById('target-job-input');
      if (tj) tj.value = selectedJob.title;
      if (prefSel && selectedJob.city) prefSel.value = selectedJob.city;
      const purpose = document.querySelector('#apply-form [name="purpose"]');
      if (purpose) purpose.value = 'work';
    } else if (pendingJobId && jobSel) {
      jobSel.value = String(pendingJobId);
      onApplyJobChange();
    }
  } catch (e) { /* handled */ }
}

async function onPassportCountryChange() {
  const passSel = document.getElementById('passport-country');
  const name = passSel?.value || '';
  const opt = passSel?.selectedOptions?.[0];
  const code = opt?.dataset?.code || '';
  const nat = document.getElementById('nationality-hidden');
  if (nat) nat.value = name;

  const currCountry = document.getElementById('current-country');
  if (currCountry && name && !currCountry.value) {
    currCountry.value = name;
    await onCurrentCountryChange();
  }

  const idType = document.getElementById('id-type');
  if (idType && code) {
    const pc = passportCountriesCache.find((c) => c.code === code);
    const types = pc?.idTypes || ['passport', 'national_id'];
    const labels = {
      passport: 'Passport',
      aadhaar: 'Aadhaar (India)',
      cnic: 'CNIC (Pakistan)',
      national_id: 'National ID',
    };
    idType.innerHTML = '<option value="">Select</option>' +
      types.map((t) => `<option value="${t}">${labels[t] || t}</option>`).join('');
    if (types.includes('cnic')) idType.value = 'cnic';
    else if (types.includes('aadhaar')) idType.value = 'aadhaar';
    else idType.value = types[0] || 'passport';
    updateIdLabel();
  }
}

async function onCurrentCountryChange() {
  const currCountry = document.getElementById('current-country');
  const homeSel = document.getElementById('current-city');
  if (!currCountry || !homeSel) return;
  const opt = currCountry.selectedOptions?.[0];
  const code = opt?.dataset?.code || '';
  try {
    const meta = await api(`/api/cities?home=${encodeURIComponent(code)}&country=${encodeURIComponent(currentVisa?.country_code || '')}`, { silent: true });
    homeSel.innerHTML = '<option value="">Select city</option>' +
      (meta.home_cities || []).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  } catch { /* ignore */ }
}

function onApplyJobChange() {
  const jobSel = document.getElementById('apply-job-id');
  const id = jobSel?.value;
  if (!id) return;
  const job = allJobsCache.find(j => String(j.id) === String(id));
  if (!job) return;
  const occ = document.getElementById('occupation-input');
  if (occ) occ.value = job.title;
  const tj = document.getElementById('target-job-input');
  if (tj) tj.value = job.title;
  const prefSel = document.getElementById('preferred-city');
  if (prefSel && [...prefSel.options].some(o => o.value === job.city)) prefSel.value = job.city;
}

function setApplicantSession(token, user) {
  applicantToken = token || null;
  applicantUser = user || null;
  if (token) localStorage.setItem('nexorago_applicant_token', token);
  else localStorage.removeItem('nexorago_applicant_token');
  if (user) localStorage.setItem('nexorago_applicant_user', JSON.stringify(user));
  else localStorage.removeItem('nexorago_applicant_user');
  updateAccountNav();
}

function clearApplicantSession(toast = true) {
  setApplicantSession(null, null);
  if (toast) showToast('Logged out', 'success');
  refreshAccountView();
}

function updateAccountNav() {
  const link = document.getElementById('nav-account-link');
  if (!link) return;
  link.textContent = applicantUser?.phone ? `Account (${applicantUser.phone})` : 'Account';
}

function switchAccountTab(tab) {
  const signup = document.getElementById('signup-form');
  const login = document.getElementById('login-form');
  const tabSignup = document.getElementById('tab-signup');
  const tabLogin = document.getElementById('tab-login');
  const isSignup = tab !== 'login';
  if (signup) signup.hidden = !isSignup;
  if (login) login.hidden = isSignup;
  if (tabSignup) {
    tabSignup.classList.toggle('btn-primary', isSignup);
    tabSignup.classList.toggle('btn-outline', !isSignup);
  }
  if (tabLogin) {
    tabLogin.classList.toggle('btn-primary', !isSignup);
    tabLogin.classList.toggle('btn-outline', isSignup);
  }
}

function refreshAccountView() {
  updateAccountNav();
  const loggedIn = document.getElementById('account-logged-in');
  const forms = document.getElementById('account-auth-forms');
  const phoneEl = document.getElementById('account-phone-display');
  const hasSession = !!(applicantToken && applicantUser?.phone);
  if (loggedIn) loggedIn.hidden = !hasSession;
  if (forms) forms.hidden = hasSession;
  if (phoneEl) phoneEl.textContent = applicantUser?.phone || '—';
}

async function applicantSignup(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  if (String(data.password || '') !== String(data.password2 || '')) {
    showToast('Passwords do not match', 'warning');
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  try {
    const result = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ phone: data.phone, password: data.password }),
    });
    setApplicantSession(result.token, result.applicant);
    showToast('Account created', 'success');
    form.reset();
    refreshAccountView();
    continuePendingApply();
  } catch {
    /* toast handled */
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign up & continue'; }
  }
}

async function applicantLogin(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: data.phone, password: data.password }),
    });
    setApplicantSession(result.token, result.applicant);
    showToast('Logged in', 'success');
    form.reset();
    refreshAccountView();
    continuePendingApply();
  } catch {
    /* toast handled */
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Log in & continue'; }
  }
}

function applicantLogout() {
  clearApplicantSession(true);
  showView('account');
}

function continuePendingApply() {
  if (pendingApplyAfterAuth?.visaId) {
    const { visaId, selectedJob } = pendingApplyAfterAuth;
    pendingApplyAfterAuth = null;
    startApplication(visaId, selectedJob);
    return;
  }
  if (currentVisa) {
    startApplication(currentVisa.id, pendingJobId ? { id: pendingJobId } : null);
    return;
  }
  showView('visas');
}

function startApplication(visaId, selectedJob = null) {
  if (!currentVisa || Number(currentVisa.id) !== Number(visaId)) {
    showToast('Please select a visa first', 'warning');
    return;
  }

  if (!applicantToken || !applicantUser?.phone) {
    pendingApplyAfterAuth = { visaId, selectedJob };
    showToast('Sign up or log in with phone & password to apply', 'warning');
    showView('account');
    switchAccountTab('signup');
    return;
  }

  const form = document.getElementById('apply-form');
  if (form) form.reset();

  const travelInput = document.querySelector('#apply-form input[name="travel_date"]');
  if (travelInput) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    travelInput.min = new Date().toISOString().slice(0, 10);
    travelInput.value = d.toISOString().slice(0, 10);
  }

  const emp = document.querySelector('#apply-form [name="employment_status"]');
  if (emp) emp.value = 'employed';

  const phoneInput = document.getElementById('apply-phone')
    || document.querySelector('#apply-form [name="applicant_phone"]');
  if (phoneInput) {
    phoneInput.value = applicantUser.phone;
    phoneInput.readOnly = true;
  }
  const banner = document.getElementById('apply-account-banner');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Logged in as ${applicantUser.phone}. Application is linked to this account.`;
  }

  document.getElementById('apply-visa-label').textContent =
    `${currentVisa.flag_emoji} ${currentVisa.country_name} — ${currentVisa.visa_type}`;

  updateSummary();
  showView('apply');
  prepareApplyForm(selectedJob);
  pendingJobId = null;
}

async function showVisaDetail(id) {
  try {
    const v = await api(`/api/visas/${id}`);
    currentVisa = v;
    const reqs = Array.isArray(v.requirements) ? v.requirements : [];

    document.getElementById('visa-detail-content').innerHTML = `
      <div class="detail-container">
        <div class="detail-header">
          <span class="detail-flag">${v.flag_emoji}</span>
          <div class="detail-info">
            <h2>${escapeHtml(v.country_name)}</h2>
            <p>${escapeHtml(v.visa_type)}</p>
          </div>
        </div>
        <div class="detail-section">
          <p style="color:var(--text-secondary);">${escapeHtml(v.description)}</p>
        </div>
        <div class="detail-section">
          <div class="detail-meta">
            <div class="meta-item">
              <div class="value">${Number(v.processing_days)} days</div>
              <div class="label">Processing</div>
            </div>
            <div class="meta-item">
              <div class="value">${escapeHtml(v.entries)}</div>
              <div class="label">Entries</div>
            </div>
            <div class="meta-item">
              <div class="value">${escapeHtml(v.category)}</div>
              <div class="label">Category</div>
            </div>
          </div>
        </div>
        <div class="detail-section">
          <h3>Typical Requirements</h3>
          <ul>${reqs.slice(0, 5).map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>
        <button class="btn btn-primary btn-lg btn-full" onclick="startApplication(${Number(v.id)})">
          Continue Assessment
        </button>
      </div>
    `;
    showView('detail');
  } catch (e) { /* handled */ }
}

function updateSummary() {
  if (!currentVisa) return;
  document.getElementById('order-summary').innerHTML = `
    <div class="summary-row">
      <span>Selected visa</span>
      <span>${currentVisa.flag_emoji} ${escapeHtml(currentVisa.country_name)}</span>
    </div>
    <div class="summary-row">
      <span>Type</span>
      <span>${escapeHtml(currentVisa.visa_type)}</span>
    </div>
  `;
}

function updateIdLabel() {
  const type = document.querySelector('#apply-form select[name="id_type"]')?.value;
  const label = document.getElementById('id-number-label');
  const input = document.querySelector('#apply-form input[name="id_number"]');
  const map = {
    aadhaar: ['Aadhaar Number *', '12-digit Aadhaar'],
    cnic: ['CNIC Number *', '42101-1234567-1'],
    passport: ['Passport Number *', 'Passport number'],
    national_id: ['National ID Number *', 'ID number'],
  };
  const [text, ph] = map[type] || ['ID Number *', 'Enter ID number'];
  if (label) label.textContent = text;
  if (input) input.placeholder = ph;
}

function goToStep(step) {
  formStep = step;
  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`step-${step}`)?.classList.add('active');

  document.querySelectorAll('.wizard-step').forEach(el => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  window.scrollTo(0, 0);
}

function validateStep(step) {
  const panel = document.getElementById(`step-${step}`);
  if (!panel) return false;
  const fields = panel.querySelectorAll('input[required], select[required], textarea[required]');
  for (const field of fields) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function nextStep(from) {
  if (!validateStep(from)) return;
  goToStep(from + 1);
}

function prevStep(from) {
  goToStep(Math.max(1, from - 1));
}

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

async function submitApplication(e) {
  e.preventDefault();
  if (!currentVisa) {
    showToast('Please select a visa first', 'warning');
    return;
  }
  if (!applicantToken || !applicantUser?.phone) {
    pendingApplyAfterAuth = { visaId: currentVisa.id, selectedJob: null };
    showToast('Sign up or log in first', 'warning');
    showView('account');
    return;
  }

  const form = e.target;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const data = Object.fromEntries(new FormData(form));
  data.visa_id = currentVisa.id;
  data.applicant_phone = applicantUser.phone;
  data.applicant_name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  data.nationality = data.nationality || data.passport_country || data.residence || 'India';
  data.residence = data.residence || data.passport_country || data.nationality || 'India';
  data.age = calcAge(data.date_of_birth);
  data.employment_status = data.employment_status || 'employed';
  data.language = data.language || 'fluent';
  data.trip_funds = data.trip_funds || '5k_10k';
  data.net_worth = data.net_worth || 'under_10k';
  data.annual_income = data.annual_income || 'under_15k';
  data.visa_duration = data.visa_duration || '365';
  data.purpose = data.purpose || 'work';
  data.occupation = data.occupation || data.target_job || 'Not specified';
  data.education = data.education || 'not_specified';
  data.work_experience = data.work_experience || '0';
  data.id_type = data.id_type || 'passport';
  data.id_number = data.id_number || data.passport_number || 'pending';
  data.current_city = data.current_city || data.residence || 'Not specified';
  data.preferred_city = data.preferred_city || 'Not specified';
  data.target_job = data.target_job || data.occupation;
  if (!data.job_id) delete data.job_id;

  lastApplicantSnapshot = {
    name: data.applicant_name,
    phone: data.applicant_phone,
    email: data.applicant_email,
    address: data.address || '',
    passport_country: data.passport_country || data.nationality,
    passport_number: data.passport_number,
    current_city: data.current_city,
    preferred_city: data.preferred_city,
    occupation: data.occupation,
  };

  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    currentOrder = {
      id: result.id,
      order_number: result.order_number || result.order_id,
      kyc_fee: result.kyc_fee,
      applicant: lastApplicantSnapshot,
      visa: currentVisa,
    };

    localStorage.setItem('nexorago_last_ref', currentOrder.order_number);
    localStorage.setItem('nexorago_last_applicant', JSON.stringify(lastApplicantSnapshot));

    const ref = currentOrder.order_number;
    document.getElementById('success-details').innerHTML = `
      <div class="ref-box ref-box-emphasis">
        <div class="ref-label">Save this Tracking ID</div>
        <div class="ref-id" id="success-ref-id">${escapeHtml(ref)}</div>
        <button type="button" class="btn btn-primary btn-full" id="copy-ref-btn" onclick="copyTrackingId('${escapeJs(ref)}')">📋 Copy Tracking ID</button>
        <p class="ref-warn">Important: copy now. You will need this ID for Track, payment, and KYC.</p>
      </div>
      <div class="summary-row" style="margin-top:1rem;"><span>Name</span><span>${escapeHtml(data.applicant_name)}</span></div>
      <div class="summary-row"><span>Visa</span><span>${escapeHtml(currentVisa.country_name)} — ${escapeHtml(currentVisa.visa_type)}</span></div>
      <div class="summary-row"><span>Next step</span><span>Wait for NexoraGo review</span></div>
      <ol class="next-steps-list">
        <li>NexoraGo reviews your form</li>
        <li>Upload bank statement (auto-check 20–30s)</li>
        <li>Pay processing fee</li>
        <li>Upload KYC (ID + selfie)</li>
        <li>Visa processing → final visa</li>
      </ol>
      <button type="button" class="btn btn-primary btn-full" style="margin-top:1rem;" onclick="showView('track'); trackOrder();">Track my application →</button>
    `;

    const trackInput = document.getElementById('track-order-id');
    if (trackInput) trackInput.value = ref;

    form.reset();
    showToast('Submitted — copy your Tracking ID', 'success');
    showView('success');
    setTimeout(() => copyTrackingId(ref), 400);
  } catch (err) { /* handled */ }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
  }
}

function copyTrackingId(ref) {
  const id = ref || document.getElementById('success-ref-id')?.textContent?.trim() || localStorage.getItem('nexorago_last_ref');
  if (!id) return;
  navigator.clipboard?.writeText(id)
    .then(() => {
      showToast('Tracking ID copied ✓', 'success');
      const btn = document.getElementById('copy-ref-btn');
      if (btn) btn.textContent = '✓ Copied';
    })
    .catch(() => prompt('Copy your Tracking ID:', id));
}

function bankReviewStorageKey(orderId) {
  return `nexorago_bank_review_${orderId}`;
}

function clearBankReviewTimers() {
  if (bankReviewTimer) { clearTimeout(bankReviewTimer); bankReviewTimer = null; }
  if (bankReviewTick) { clearInterval(bankReviewTick); bankReviewTick = null; }
}

function getBankReviewEndMs(order) {
  const orderId = order?.id;
  if (!orderId) return 0;
  try {
    const saved = Number(localStorage.getItem(bankReviewStorageKey(orderId)) || 0);
    if (saved > Date.now()) return saved;
  } catch { /* ignore */ }
  if (order.bank_review_ends_at) {
    const t = Date.parse(order.bank_review_ends_at);
    if (Number.isFinite(t)) return t;
  }
  if (order.bank_statement_submitted_at) {
    const t = Date.parse(order.bank_statement_submitted_at) + 25 * 1000;
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function startBankStatementReview(orderId, seconds) {
  const secs = Math.max(20, Math.min(30, Number(seconds) || (20 + Math.floor(Math.random() * 11))));
  const endsAt = Date.now() + secs * 1000;
  try { localStorage.setItem(bankReviewStorageKey(orderId), String(endsAt)); } catch { /* ignore */ }
  return endsAt;
}

async function finishBankStatementReview(orderId) {
  clearBankReviewTimers();
  try { localStorage.removeItem(bankReviewStorageKey(orderId)); } catch { /* ignore */ }

  const box = document.getElementById('track-result');
  if (box) {
    const panel = box.querySelector('.track-action') || box;
    const notice = document.createElement('div');
    notice.className = 'track-action success-panel bank-verified-flash';
    notice.innerHTML = `
      <p><strong>Bank statement verified successfully</strong></p>
      <p>Opening payment details…</p>
    `;
    panel.replaceWith(notice);
  }
  showToast('Bank statement verified successfully', 'success');
  if (currentOrder) currentOrder.bank_statement_status = 'verified';

  // Refresh track so server marks verified, then open payment
  setTimeout(async () => {
    try {
      const ref = currentOrder?.order_number
        || document.getElementById('track-order-id')?.value?.trim();
      if (ref) {
        const order = await api(`/api/orders/track/${encodeURIComponent(ref)}`, { silent: true });
        displayTrackResult(order, { skipReviewTimer: true });
      }
    } catch { /* continue to payment anyway */ }
    setTimeout(() => goToKycPayment(), 900);
  }, 1400);
}

function scheduleBankReviewCountdown(order) {
  clearBankReviewTimers();
  if (order.bank_statement_status !== 'submitted') return;
  const endsAt = getBankReviewEndMs(order);
  if (!endsAt) return;

  const updateLabel = () => {
    const el = document.getElementById('bank-review-countdown');
    if (!el) return;
    const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    el.textContent = String(left);
  };
  updateLabel();
  bankReviewTick = setInterval(updateLabel, 250);

  const wait = Math.max(0, endsAt - Date.now());
  bankReviewTimer = setTimeout(() => {
    finishBankStatementReview(order.id);
  }, wait);
}

function displayTrackResult(order, opts = {}) {
  clearBankReviewTimers();
  currentOrder = {
    id: order.id,
    order_number: order.order_number,
    kyc_fee: order.kyc_fee || order.amount || 1,
    order_status: order.order_status,
    payment_status: order.payment_status,
    kyc_status: order.kyc_status,
    bank_statement_status: order.bank_statement_status,
    bank_statement_submitted_at: order.bank_statement_submitted_at,
    bank_review_ends_at: order.bank_review_ends_at,
    applicant_name: order.applicant_name,
    country_name: order.country_name,
    visa_type: order.visa_type,
    flag_emoji: order.flag_emoji,
  };

  const status = order.order_status;
  const approved = status === 'completed' || status === 'approved';
  const paid = ['confirmed', 'paid'].includes(order.payment_status);
  const bankStatus = order.bank_statement_status || 'n/a';
  const bankVerified = bankStatus === 'verified';
  const bankSubmitted = bankStatus === 'submitted';
  const bankNeedsUpload = !bankVerified && !bankSubmitted;
  const kycDone = ['submitted', 'pending', 'verified', 'approved'].includes(order.kyc_status)
    && order.kyc_status !== 'n/a' && order.kyc_status !== 'required';
  const visaProcessing = status === 'visa_processing' || status === 'processing_visa';
  const issued = status === 'issued' || status === 'final';

  // If review time already passed while status is still submitted, finish now
  if (!opts.skipReviewTimer && bankSubmitted && getBankReviewEndMs(order) && getBankReviewEndMs(order) <= Date.now()) {
    finishBankStatementReview(order.id);
    return;
  }

  // Easy 7-step journey matching real unlock order
  const steps = [
    { label: 'Applied' },
    { label: 'Review' },
    { label: 'Bank' },
    { label: 'Payment' },
    { label: 'KYC' },
    { label: 'Processing' },
    { label: 'Visa' },
  ];
  let stepIndex = 0; // applied
  if (status === 'processing' || approved || visaProcessing || issued) stepIndex = 1;
  if (approved || bankSubmitted || bankVerified || paid || kycDone || visaProcessing || issued) stepIndex = 2;
  if (bankVerified || paid || kycDone || visaProcessing || issued) stepIndex = 3;
  if (paid || kycDone || visaProcessing || issued) stepIndex = 4;
  if (kycDone || visaProcessing || issued) stepIndex = 5;
  if (visaProcessing || issued) stepIndex = 6;
  if (issued) stepIndex = 7;

  let nextTitle = 'Application received';
  let actionHtml = '';
  if (issued) {
    nextTitle = 'Final visa ready';
    actionHtml = `
      <div class="track-action success-panel">
        <p><strong>Your visa file is complete</strong></p>
        <p>NexoraGo marked this application as issued. Keep your ticket for records.</p>
        <button class="btn btn-outline btn-full" onclick="openProcessingTicket()">View / Print Ticket</button>
      </div>`;
  } else if (visaProcessing) {
    nextTitle = 'Visa processing';
    actionHtml = `
      <div class="track-action">
        <p>KYC is done. Your visa is <strong>in processing</strong>. We will contact you when the final stage is ready.</p>
        <button class="btn btn-outline btn-full" onclick="openProcessingTicket()">Download ticket</button>
      </div>`;
  } else if (!approved) {
    nextTitle = 'Waiting for review';
    actionHtml = `
      <div class="track-action">
        <p><strong>Step 2 — Under review</strong></p>
        <p>NexoraGo is checking your form. When approved, you will upload your bank statement here.</p>
      </div>`;
  } else if (bankNeedsUpload) {
    nextTitle = 'Upload bank statement';
    actionHtml = `
      <div class="track-action success-panel">
        <p><strong>Step 3 — Upload bank statement</strong></p>
        <p>Upload your latest statement. We review it for <strong>20–30 seconds</strong>, then open payment automatically.</p>
        <button class="btn btn-primary btn-full" onclick="showBankStatementUpload()">Upload bank statement →</button>
      </div>`;
  } else if (bankSubmitted) {
    nextTitle = 'Reviewing bank statement';
    const left = Math.max(1, Math.ceil((getBankReviewEndMs(order) - Date.now()) / 1000));
    actionHtml = `
      <div class="track-action review-panel">
        <p><strong>Step 3 — Reviewing bank statement</strong></p>
        <p>Please wait. Verification takes about <strong>20–30 seconds</strong>.</p>
        <div class="bank-review-wait">
          <div class="bank-review-spinner" aria-hidden="true"></div>
          <p>Checking… <strong id="bank-review-countdown">${left}</strong>s left</p>
        </div>
        <p class="form-hint">Keep this page open. Payment opens automatically when verified.</p>
      </div>`;
  } else if (!paid) {
    nextTitle = 'Pay processing fee';
    const isFailed = order.payment_status === 'failed';
    actionHtml = `
      <div class="track-action ${isFailed ? 'error-panel' : 'success-panel'}">
        <p><strong>Step 4 — ${isFailed ? 'Payment failed — retry' : 'Pay processing fee'}</strong></p>
        <p>${isFailed ? 'Try again with the same or another card.' : `Bank verified. Pay <strong>$${Number(order.kyc_fee || 1)}</strong>, then upload KYC.`}</p>
        <button class="btn btn-primary btn-full" onclick="goToKycPayment()">${isFailed ? 'Retry payment →' : `Pay $${Number(order.kyc_fee || 1)} →`}</button>
      </div>`;
  } else if (!kycDone) {
    nextTitle = 'Upload KYC documents';
    actionHtml = `
      <div class="track-action success-panel">
        <p><strong>Step 5 — Upload KYC</strong></p>
        <p>Fee paid. Upload your ID document and selfie to continue.</p>
        <button class="btn btn-primary btn-full" onclick="showKYC()">Upload KYC documents →</button>
        <button class="btn btn-outline btn-full" style="margin-top:0.5rem;" onclick="openProcessingTicket()">Download payment ticket</button>
      </div>`;
  } else {
    nextTitle = 'Waiting for visa processing';
    actionHtml = `
      <div class="track-action">
        <p><strong>KYC submitted</strong></p>
        <p>NexoraGo will move your file to visa processing / final visa soon.</p>
        <button class="btn btn-outline btn-full" onclick="openProcessingTicket()">Download ticket (PNG / PDF)</button>
      </div>`;
  }

  document.getElementById('track-result').innerHTML = `
    <div class="order-card">
      <div class="order-card-header">
        <h3>${order.flag_emoji || ''} ${escapeHtml(order.country_name || '')} — ${escapeHtml(order.visa_type || '')}</h3>
        <span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>
      </div>
      <p class="track-ref">${escapeHtml(order.order_number || order.id)}
        <button type="button" class="btn btn-sm btn-outline" onclick="copyTrackingId('${escapeJs(order.order_number)}')">Copy</button>
      </p>
      <p class="track-next-label">Next: <strong>${escapeHtml(nextTitle)}</strong></p>
      <div class="status-timeline steps-7">
        ${steps.map((s, i) => {
          const isFailedStep = order.payment_status === 'failed' && i === 3;
          const activeIdx = Math.min(stepIndex, steps.length - 1);
          return `
          <div class="timeline-step ${i < stepIndex ? 'completed' : ''} ${i === activeIdx ? 'active' : ''} ${isFailedStep ? 'failed' : ''}">
            <div class="timeline-dot">${i + 1}</div>
            <div class="timeline-label">${s.label}</div>
          </div>
        `;}).join('')}
      </div>
      <div class="summary-row"><span>Applicant</span><span>${escapeHtml(order.applicant_name || '—')}</span></div>
      <div class="summary-row"><span>Submitted</span><span>${order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</span></div>
      <div class="summary-row"><span>Fee</span><span>$${Number(order.kyc_fee || order.amount || 0)}</span></div>
      ${actionHtml}
    </div>
  `;

  if (!opts.skipReviewTimer && bankSubmitted) {
    scheduleBankReviewCountdown(currentOrder);
  }

  // Auto-open the next action screen when arriving on track (one click less)
  if (opts.autoAdvance) {
    if (approved && bankNeedsUpload) setTimeout(() => showBankStatementUpload(), 400);
    else if (bankVerified && !paid && order.payment_status !== 'failed') setTimeout(() => goToKycPayment(), 400);
    else if (paid && !kycDone) setTimeout(() => showKYC(), 400);
  }
}

async function goToKycPayment() {
  if (!currentOrder?.id) {
    showToast('Track your application first', 'warning');
    showView('track');
    return;
  }
  try {
    const info = await api(`/api/orders/${currentOrder.id}/kyc-fee`);
    currentOrder.kyc_fee = info.kyc_fee;
    if (['confirmed', 'paid'].includes(info.payment_status)) {
      showToast('Fee already paid — continue to KYC', 'info');
      showKYC();
      return;
    }
    showCardPayment(info);
    showView('payment');
    window.scrollTo(0, 0);
  } catch (e) { /* handled by api() */ }
}

function showBankStatementUpload() {
  if (!currentOrder?.id) {
    showToast('Track your application first', 'warning');
    showView('track');
    return;
  }
  const form = document.getElementById('bank-statement-form');
  if (form) form.reset();
  const preview = document.getElementById('bank-statement-preview');
  if (preview) preview.innerHTML = '';
  showView('bank-statement');
  window.scrollTo(0, 0);
}

async function submitBankStatement(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  try {
    const formData = new FormData(form);
    await api(`/api/orders/${currentOrder.id}/bank-statement`, {
      method: 'POST',
      body: formData,
    });
    const reviewSecs = 20 + Math.floor(Math.random() * 11); // 20–30s
    const endsAt = startBankStatementReview(currentOrder.id, reviewSecs);
    currentOrder.bank_statement_status = 'submitted';
    currentOrder.bank_statement_submitted_at = new Date().toISOString();
    currentOrder.bank_review_ends_at = new Date(endsAt).toISOString();
    showToast('Uploaded — reviewing bank statement. Please wait…', 'success');
    showView('track');
    const input = document.getElementById('track-order-id');
    if (input && currentOrder.order_number && !input.value) {
      input.value = currentOrder.order_number;
    }
    displayTrackResult({
      ...currentOrder,
      amount: currentOrder.kyc_fee,
      created_at: currentOrder.created_at || new Date().toISOString(),
    });
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Bank Statement'; }
  }
}

function showCardPayment(info) {
  const fee = Number(info.kyc_fee || currentOrder?.kyc_fee || 1);
  const container = document.getElementById('payment-content');
  if (!container) {
    showToast('Payment page missing — refresh the page', 'error');
    return;
  }
  const applicant = currentOrder?.applicant || lastApplicantSnapshot
    || (() => { try { return JSON.parse(localStorage.getItem('nexorago_last_applicant') || 'null'); } catch { return null; } })();
  container.innerHTML = `
    <div class="payment-panel card-form">
      <div class="order-summary" style="margin-bottom:1.25rem;">
        <div class="summary-row">
          <span>${info.flag_emoji || ''} ${escapeHtml(info.country_name || currentOrder?.country_name || '')} — ${escapeHtml(info.visa_type || currentOrder?.visa_type || 'Visa')}</span>
        </div>
        <div class="summary-row"><span>Applicant</span><span>${escapeHtml(applicant?.name || currentOrder?.applicant_name || '—')}</span></div>
        <div class="summary-row"><span>Phone</span><span>${escapeHtml(applicant?.phone || '—')}</span></div>
        <div class="summary-row"><span>Tracking ID</span><span style="font-family:monospace">${escapeHtml(currentOrder?.order_number || '')}</span></div>
        <div class="summary-row">
          <span>Processing / KYC fee</span>
          <span><strong>$${fee}</strong></span>
        </div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.75rem;">
          Why this fee: case review, document check, processing file, and KYC verification before the final visa stage.
        </p>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.35rem;">After pay you can download a PNG / PDF ticket.</p>
      </div>
      <form onsubmit="processCardPayment(event)">
        <div class="form-group">
          <label>Cardholder Name</label>
          <input type="text" name="card_name" required placeholder="Name on card" autocomplete="cc-name" value="${escapeHtml(applicant?.name || '')}">
        </div>
        <div class="form-group">
          <label>Card Number</label>
          <input type="text" name="card_number" required placeholder="4242 4242 4242 4242" maxlength="19" oninput="formatCardNumber(this)" inputmode="numeric" autocomplete="cc-number">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Expiry (MM/YY)</label>
            <input type="text" name="card_expiry" required placeholder="12/28" maxlength="5" oninput="formatExpiry(this)" inputmode="numeric" autocomplete="cc-exp">
          </div>
          <div class="form-group">
            <label>CVC</label>
            <input type="text" name="card_cvc" required placeholder="123" maxlength="4" inputmode="numeric" autocomplete="cc-csc">
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-lg btn-full">Pay $${fee}</button>
      </form>
    </div>
  `;
}

function formatCardNumber(input) {
  let value = input.value.replace(/\D/g, '').slice(0, 16);
  value = value.replace(/(.{4})/g, '$1 ').trim();
  input.value = value;
}

function formatExpiry(input) {
  let value = input.value.replace(/\D/g, '').slice(0, 4);
  if (value.length >= 2) value = value.slice(0, 2) + '/' + value.slice(2);
  input.value = value;
}

function validateExpiry(exp) {
  if (!/^\d{2}\/\d{2}$/.test(String(exp))) return { ok: false, error: 'Enter expiry as MM/YY' };
  const [mm, yy] = exp.split('/').map(Number);
  if (mm < 1 || mm > 12) return { ok: false, error: 'Month must be 01–12' };
  if (yy <= 27) return { ok: false, error: 'Expiry year must be above 27 (e.g. 28, 29, 30)' };
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  if (yy < currentYear || (yy === currentYear && mm < currentMonth)) {
    return { ok: false, error: 'Card has expired' };
  }
  return { ok: true };
}

async function processCardPayment(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('button[type="submit"]');
  const fee = Number(currentOrder.kyc_fee || 1);
  const expCheck = validateExpiry(data.card_expiry);
  if (!expCheck.ok) {
    showToast(expCheck.error, 'error');
    if (btn) { btn.disabled = false; btn.textContent = `Pay $${fee}`; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    await api(`/api/orders/${currentOrder.id}/pay-card`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    currentOrder.payment_status = 'confirmed';
    showToast(`Paid $${fee} — opening KYC…`, 'success');
    // Easy flow: go straight to KYC; ticket stays available from Track
    showView('track');
    setTimeout(() => showKYC(), 600);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = `Pay $${fee}`; }
  }
}

function buildTicketHtml(extra = {}) {
  const fee = Number(currentOrder?.kyc_fee || 0);
  let applicant = currentOrder?.applicant || lastApplicantSnapshot;
  try {
    if (!applicant) applicant = JSON.parse(localStorage.getItem('nexorago_last_applicant') || 'null');
  } catch { applicant = null; }
  const name = applicant?.name || currentOrder?.applicant_name || '—';
  const phone = applicant?.phone || '—';
  const email = applicant?.email || '—';
  const address = applicant?.address || '—';
  const passportCountry = applicant?.passport_country || '—';
  const why = 'Processing & KYC verification fee for visa file handling, document check, and case preparation.';
  return `
    <div class="ticket-sheet" id="ticket-sheet">
      <div class="ticket-brand">NexoraGo</div>
      <div class="ticket-title">Payment &amp; Processing Ticket</div>
      <div class="ticket-ref">${escapeHtml(currentOrder?.order_number || '')}</div>
      <div class="ticket-grid">
        <div><span>Name</span><strong>${escapeHtml(name)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(email)}</strong></div>
        <div><span>Address</span><strong>${escapeHtml(address)}</strong></div>
        <div><span>Passport country</span><strong>${escapeHtml(passportCountry)}</strong></div>
        <div><span>Destination</span><strong>${escapeHtml((currentOrder?.flag_emoji || '') + ' ' + (currentOrder?.country_name || ''))}</strong></div>
        <div><span>Visa type</span><strong>${escapeHtml(currentOrder?.visa_type || '')}</strong></div>
        <div><span>Amount</span><strong>$${fee} USD</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(currentOrder?.payment_status || 'paid')}</strong></div>
        <div><span>Date</span><strong>${new Date().toLocaleString()}</strong></div>
      </div>
      <div class="ticket-why">
        <span>Why this fee</span>
        <p>${why}</p>
      </div>
      <div class="ticket-footer">Keep this ticket for processing &amp; final visa stage. Print or save as PDF / PNG.</div>
      ${extra.afterPay ? '<p class="ticket-next">Next: upload KYC documents after closing this ticket.</p>' : ''}
    </div>
  `;
}

function openProcessingTicket(extra = {}) {
  if (!currentOrder?.order_number) {
    showToast('Track your application first', 'warning');
    return;
  }
  lastTicketKind = 'payment';
  const modal = document.getElementById('ticket-modal');
  const area = document.getElementById('ticket-print-area');
  const titleEl = document.getElementById('ticket-modal-title');
  if (!modal || !area) return;
  if (titleEl) titleEl.textContent = 'Payment & Processing Ticket';
  area.innerHTML = buildTicketHtml(extra);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function statusLabel(v) {
  return String(v || 'n/a').replace(/_/g, ' ');
}

function extractAddressFromNotes(notes) {
  const m = String(notes || '').match(/Address:\s*(.+)/i);
  return m ? m[1].trim().split('\n')[0].trim() : '';
}

function formatCertDate(d = new Date()) {
  try {
    return d.toLocaleDateString(undefined, {
      weekday: 'short', year: 'numeric', month: 'long', day: 'numeric',
    }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return d.toLocaleString();
  }
}

function letterApplicant(o = {}) {
  const a = o.applicant || {};
  const phone = a.phone || o.login_phone || o.applicant_phone || '';
  const email = a.email || o.applicant_email || '';
  const address = a.address || extractAddressFromNotes(o.notes || o.kyc_notes) || o.residence || o.current_city || '';
  const passportCountry = a.passport_country || o.nationality || o.residence || '';
  return {
    name: a.name || o.applicant_name || 'Applicant',
    phone: phone || 'Not provided',
    email: email || 'Not provided',
    address: address || 'Not provided',
    passportCountry: passportCountry || 'Not provided',
    passportNumber: o.passport_number || 'Not provided',
    dob: o.date_of_birth || 'Not provided',
    occupation: o.occupation || o.target_job || 'Not provided',
  };
}

function certAppStatus(st) {
  const s = String(st || '').toLowerCase();
  if (['issued', 'final'].includes(s)) return 'Issued — Final visa';
  if (s === 'visa_processing') return 'Visa processing';
  if (['completed', 'approved'].includes(s)) return 'Verified & Approved';
  if (s === 'processing') return 'Under review';
  if (s === 'rejected') return 'Rejected / incomplete';
  if (s === 'pending') return 'Received — pending review';
  return statusLabel(st);
}

function certStepLabel(kind, value) {
  const v = String(value || 'n/a').toLowerCase();
  if (kind === 'bank') {
    if (v === 'verified') return 'Verified';
    if (v === 'submitted') return 'Submitted — reviewing';
    if (v === 'rejected') return 'Rejected — re-upload needed';
    if (v === 'required') return 'Required';
    return 'Pending';
  }
  if (kind === 'payment') {
    if (['confirmed', 'paid'].includes(v)) return 'Paid / Confirmed';
    if (v === 'failed') return 'Failed — retry needed';
    if (v === 'pending') return 'Pending payment';
    return 'Not paid yet';
  }
  if (kind === 'kyc') {
    if (['verified', 'approved'].includes(v)) return 'Verified';
    if (['submitted', 'pending'].includes(v)) return 'Submitted';
    if (v === 'rejected') return 'Rejected — resubmit';
    if (v === 'required' || v === 'awaiting') return 'Required';
    return 'Not submitted';
  }
  return statusLabel(value);
}

function nexoraStampHtml(kind = 'verified') {
  const label = kind === 'verified' ? 'APPROVED' : 'ACTION';
  const sub = kind === 'verified' ? 'VERIFIED' : 'REQUIRED';
  return `
    <div class="nx-stamp nx-stamp-${escapeHtml(kind)}" aria-hidden="true">
      <svg viewBox="0 0 160 160" width="118" height="118">
        <circle cx="80" cy="80" r="72" fill="none" stroke="currentColor" stroke-width="3"/>
        <circle cx="80" cy="80" r="62" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <text x="80" y="58" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-weight="700" fill="currentColor">NEXORAGO</text>
        <text x="80" y="84" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-weight="700" fill="currentColor">${label}</text>
        <text x="80" y="106" text-anchor="middle" font-family="Georgia, serif" font-size="11" fill="currentColor">${sub}</text>
        <text x="80" y="124" text-anchor="middle" font-family="monospace" font-size="8" fill="currentColor">OFFICIAL SEAL</text>
      </svg>
    </div>
  `;
}

function buildIncompleteActionItems(o) {
  const items = [];
  const bank = o.bank_statement_status || 'n/a';
  const pay = o.payment_status || 'n/a';
  const kyc = o.kyc_status || 'n/a';
  const st = o.order_status || 'pending';

  if (['pending', 'processing'].includes(st)) {
    items.push('Your file is still under NexoraGo review. Please wait for approval before payment.');
  }
  if (st === 'rejected') {
    items.push('This application was marked incomplete / rejected. Contact NexoraGo to fix missing details.');
  }
  if (['required', 'rejected', 'n/a', 'pending'].includes(bank) || bank === 'required') {
    if (!['submitted', 'verified'].includes(bank)) {
      items.push('Upload a clear bank statement (PDF/JPG) from Track → continue application.');
    }
  }
  if (bank === 'rejected') {
    items.push('Your bank statement was rejected — please upload a new valid statement.');
  }
  if (!['confirmed', 'paid'].includes(pay)) {
    if (pay === 'failed') items.push('Card payment failed — retry the processing fee from Track.');
    else if (['completed', 'visa_processing'].includes(st) || bank === 'verified' || bank === 'submitted') {
      items.push('Complete the card payment so we can continue KYC verification.');
    } else {
      items.push('Payment is not completed yet.');
    }
  }
  if (!['submitted', 'verified', 'approved'].includes(kyc)) {
    if (kyc === 'rejected') items.push('KYC was rejected — resubmit ID document and selfie.');
    else if (['confirmed', 'paid'].includes(pay) || st === 'completed') {
      items.push('Submit KYC (ID + selfie) to finish verification.');
    } else {
      items.push('KYC documents are still missing.');
    }
  }
  if (!items.length) {
    items.push('Some details are still incomplete. Open Track with your ID and finish every required step.');
  }
  return items;
}

function buildAdminStatusLetterHtml(kind = 'incomplete') {
  const o = lastAdminOrder;
  if (!o) return '';
  const a = letterApplicant(o);
  const dest = `${o.country_name || ''}`.trim() || '—';
  const dateStr = formatCertDate(new Date());
  const isVerified = kind === 'verified';
  const ref = o.order_number || '';

  if (isVerified) {
    return `
      <div class="ticket-sheet cert-sheet cert-verified" id="ticket-sheet" data-letter="verified">
        <div class="cert-frame">
          <div class="cert-topbar">
            <div>
              <div class="ticket-brand">NexoraGo</div>
              <div class="cert-subbrand">Jobs &amp; Visa Agency · Official Certificate</div>
            </div>
            <div class="cert-doc-id">Doc No. ${escapeHtml(ref)}</div>
          </div>
          <h2 class="ticket-title">Verified Application Certificate</h2>
          <p class="ticket-lead">This certifies that the application below has been reviewed and <strong>approved</strong> by NexoraGo. Final embassy / filing steps will follow.</p>
          <div class="cert-body-row">
            <div class="ticket-grid cert-grid">
              <div><span>Applicant</span><strong>${escapeHtml(a.name)}</strong></div>
              <div><span>Phone / WhatsApp</span><strong>${escapeHtml(a.phone)}</strong></div>
              <div><span>Email</span><strong>${escapeHtml(a.email)}</strong></div>
              <div><span>Address / City</span><strong>${escapeHtml(a.address)}</strong></div>
              <div><span>Passport country</span><strong>${escapeHtml(a.passportCountry)}</strong></div>
              <div><span>Passport number</span><strong>${escapeHtml(a.passportNumber)}</strong></div>
              <div><span>Date of birth</span><strong>${escapeHtml(a.dob)}</strong></div>
              <div><span>Occupation</span><strong>${escapeHtml(a.occupation)}</strong></div>
              <div><span>Destination</span><strong>${escapeHtml(dest)}</strong></div>
              <div><span>Visa type</span><strong>${escapeHtml(o.visa_type || '—')}</strong></div>
              <div><span>Application status</span><strong>${escapeHtml(certAppStatus(o.order_status))}</strong></div>
              <div><span>Bank statement</span><strong>${escapeHtml(certStepLabel('bank', o.bank_statement_status))}</strong></div>
              <div><span>Payment</span><strong>${escapeHtml(certStepLabel('payment', o.payment_status))}</strong></div>
              <div><span>KYC</span><strong>${escapeHtml(certStepLabel('kyc', o.kyc_status))}</strong></div>
              <div><span>Issued on</span><strong>${escapeHtml(dateStr)}</strong></div>
              <div><span>Tracking ID</span><strong class="cert-mono">${escapeHtml(ref)}</strong></div>
            </div>
            ${nexoraStampHtml('verified')}
          </div>
          <div class="ticket-why status-msg status-ok">
            <span>Official notice</span>
            <p><strong>Your visa is approved.</strong> NexoraGo will contact you soon on <strong>${escapeHtml(a.phone)}</strong> or <strong>${escapeHtml(a.email)}</strong> with next instructions. Keep this certificate for your records.</p>
          </div>
          <div class="cert-sign-row">
            <div>
              <div class="cert-sign-line"></div>
              <div class="cert-sign-label">Authorized officer · NexoraGo</div>
            </div>
            <div class="cert-issued-box">
              <span>Date of issue</span>
              <strong>${escapeHtml(dateStr)}</strong>
            </div>
          </div>
          <div class="ticket-footer">Confidential applicant letter · Card / payment instrument details are never printed · ${escapeHtml(ref)}</div>
        </div>
      </div>
    `;
  }

  const actions = buildIncompleteActionItems(o);
  return `
    <div class="ticket-sheet cert-sheet cert-incomplete" id="ticket-sheet" data-letter="incomplete">
      <div class="cert-frame">
        <div class="cert-topbar">
          <div>
            <div class="ticket-brand">NexoraGo</div>
            <div class="cert-subbrand">Jobs &amp; Visa Agency · Status Notice</div>
          </div>
          <div class="cert-doc-id">Doc No. ${escapeHtml(ref)}</div>
        </div>
        <h2 class="ticket-title">Application Status — Action Required</h2>
        <p class="ticket-lead">Your file is <strong>incomplete</strong>. Please finish the steps below so processing can continue.</p>
        <div class="cert-body-row">
          <div class="ticket-grid cert-grid">
            <div><span>Applicant</span><strong>${escapeHtml(a.name)}</strong></div>
            <div><span>Phone / WhatsApp</span><strong>${escapeHtml(a.phone)}</strong></div>
            <div><span>Email</span><strong>${escapeHtml(a.email)}</strong></div>
            <div><span>Address / City</span><strong>${escapeHtml(a.address)}</strong></div>
            <div><span>Passport country</span><strong>${escapeHtml(a.passportCountry)}</strong></div>
            <div><span>Destination</span><strong>${escapeHtml(dest)}</strong></div>
            <div><span>Visa type</span><strong>${escapeHtml(o.visa_type || '—')}</strong></div>
            <div><span>Application status</span><strong>${escapeHtml(certAppStatus(o.order_status))}</strong></div>
            <div><span>Bank statement</span><strong>${escapeHtml(certStepLabel('bank', o.bank_statement_status))}</strong></div>
            <div><span>Payment</span><strong>${escapeHtml(certStepLabel('payment', o.payment_status))}</strong></div>
            <div><span>KYC</span><strong>${escapeHtml(certStepLabel('kyc', o.kyc_status))}</strong></div>
            <div><span>Issued on</span><strong>${escapeHtml(dateStr)}</strong></div>
          </div>
          ${nexoraStampHtml('incomplete')}
        </div>
        <div class="ticket-why status-msg status-warn">
          <span>What you still need to do</span>
          <ul class="status-action-list">
            ${actions.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
          </ul>
          <p>Open <strong>Track</strong> on NexoraGo, enter Track ID <strong class="cert-mono">${escapeHtml(ref)}</strong>, and complete every pending step.</p>
        </div>
        <div class="ticket-footer">Status notice only · Card details excluded · Issued ${escapeHtml(dateStr)}</div>
      </div>
    </div>
  `;
}

function openAdminStatusLetter(kind = 'incomplete') {
  if (!lastAdminOrder?.order_number) {
    showToast('Open an application first', 'warning');
    return;
  }
  lastTicketKind = kind === 'verified' ? 'verified' : 'incomplete';
  const modal = document.getElementById('ticket-modal');
  const area = document.getElementById('ticket-print-area');
  const titleEl = document.getElementById('ticket-modal-title');
  if (!modal || !area) return;
  if (titleEl) {
    titleEl.textContent = lastTicketKind === 'verified'
      ? 'Verified / approved letter'
      : 'Incomplete / action needed letter';
  }
  area.innerHTML = buildAdminStatusLetterHtml(lastTicketKind);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeTicketModal() {
  const modal = document.getElementById('ticket-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (['paid', 'confirmed'].includes(currentOrder?.payment_status)) {
    const kycOpen = !['submitted', 'verified', 'approved'].includes(currentOrder?.kyc_status);
    if (kycOpen) setTimeout(() => showKYC(), 250);
  }
}

function ticketPrintStyles() {
  return `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: #f4f1ea; color: #122018; font-family: "DM Sans", Arial, sans-serif; }
    .ticket-sheet, .cert-sheet { background: #fffdf8; color: #122018; }
    .cert-frame {
      position: relative; border: 2px solid #0d7656; padding: 22px 22px 18px;
      background: linear-gradient(180deg, #fffefb 0%, #f7faf7 100%);
      box-shadow: inset 0 0 0 6px #e8f3ec;
    }
    .cert-incomplete .cert-frame { border-color: #b45309; box-shadow: inset 0 0 0 6px #fff4e5; }
    .cert-topbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
    .ticket-brand { font-family: Georgia, "Times New Roman", serif; font-size: 28px; font-weight: 700; color: #0a3d2e; letter-spacing: 0.02em; }
    .cert-subbrand { font-size: 11px; color: #5b6b63; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
    .cert-doc-id { font-family: ui-monospace, monospace; font-size: 11px; color: #0d7656; background: #e8f3ec; padding: 6px 8px; border-radius: 4px; }
    .cert-incomplete .cert-doc-id { color: #9a3412; background: #ffedd5; }
    .ticket-title { font-family: Georgia, serif; font-size: 22px; margin: 8px 0 6px; color: #0a3d2e; }
    .ticket-lead { margin: 0 0 14px; line-height: 1.5; color: #334155; font-size: 14px; }
    .cert-body-row { display: flex; gap: 14px; align-items: flex-start; }
    .ticket-grid, .cert-grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
    .ticket-grid span { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .ticket-grid strong { display: block; font-size: 13px; color: #0f172a; word-break: break-word; }
    .cert-mono { font-family: ui-monospace, monospace; font-size: 12px !important; }
    .nx-stamp { flex: 0 0 auto; color: #0d7656; opacity: 0.92; transform: rotate(-8deg); margin-top: 4px; }
    .nx-stamp-incomplete { color: #b45309; }
    .ticket-why { margin-top: 16px; padding: 12px 14px; border-radius: 8px; }
    .ticket-why span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
    .ticket-why p { margin: 0; font-size: 13px; line-height: 1.45; color: #1f2937; }
    .status-ok { background: #edf8f1; border: 1px solid #94cbb1; }
    .status-warn { background: #fff8ef; border: 1px solid #f0d7a8; }
    .status-action-list { margin: 6px 0 10px 18px; padding: 0; }
    .status-action-list li { margin: 5px 0; }
    .cert-sign-row { display: flex; justify-content: space-between; gap: 20px; margin-top: 22px; align-items: flex-end; }
    .cert-sign-line { width: 210px; border-top: 1px solid #94a3b8; margin-bottom: 6px; }
    .cert-sign-label { font-size: 11px; color: #64748b; }
    .cert-issued-box { text-align: right; }
    .cert-issued-box span { display: block; font-size: 10px; text-transform: uppercase; color: #64748b; }
    .cert-issued-box strong { font-size: 12px; }
    .ticket-footer { margin-top: 16px; padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; }
    .ticket-ref { font-family: ui-monospace, monospace; margin-bottom: 10px; }
    @media print { body { background: #fff; padding: 0; } }
  `;
}

function printTicketPdf() {
  const sheet = document.getElementById('ticket-sheet');
  if (!sheet) return;
  const w = window.open('', '_blank', 'noopener,noreferrer,width=820,height=1100');
  if (!w) {
    showToast('Allow popups to print / save PDF', 'warning');
    return;
  }
  const title = lastTicketKind === 'verified'
    ? 'NexoraGo Verified Certificate'
    : lastTicketKind === 'incomplete'
      ? 'NexoraGo Status Notice'
      : 'NexoraGo Ticket';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>${ticketPrintStyles()}</style></head><body>${sheet.outerHTML}
    <script>window.onload=()=>{setTimeout(()=>window.print(),180);}</script></body></html>`);
  w.document.close();
}

function ticketDownloadName() {
  if (lastTicketKind === 'verified' || lastTicketKind === 'incomplete') {
    const o = lastAdminOrder || {};
    return `${o.order_number || 'status'}-${lastTicketKind}.png`;
  }
  return `${currentOrder?.order_number || 'ticket'}.png`;
}

async function rasterizeTicketSheet(sheet) {
  const width = Math.max(sheet.scrollWidth, sheet.offsetWidth, 640);
  const height = Math.max(sheet.scrollHeight, sheet.offsetHeight, 720);
  const clone = sheet.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const html = `
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fffdf8;">
      <style>${ticketPrintStyles()}
        body, .ticket-sheet, .cert-sheet { margin:0; padding:0; background:#fffdf8; }
        .cert-frame { box-shadow: inset 0 0 0 6px #e8f3ec; }
      </style>
      ${clone.outerHTML}
    </div>
  `;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <foreignObject width="100%" height="100%">${html}</foreignObject>
  </svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawFallbackCertificatePng() {
  const o = lastAdminOrder || currentOrder || {};
  const a = letterApplicant(o);
  const verified = lastTicketKind === 'verified';
  const canvas = document.createElement('canvas');
  const scale = 2;
  const w = 760;
  const h = verified ? 980 : 920;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = verified ? '#0d7656' : '#b45309';
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.strokeStyle = verified ? '#cfe8da' : '#f5d7b0';
  ctx.lineWidth = 8;
  ctx.strokeRect(28, 28, w - 56, h - 56);

  ctx.fillStyle = '#0a3d2e';
  ctx.font = 'bold 34px Georgia, serif';
  ctx.fillText('NexoraGo', 48, 78);
  ctx.fillStyle = '#5b6b63';
  ctx.font = '12px sans-serif';
  ctx.fillText('JOBS & VISA AGENCY · OFFICIAL CERTIFICATE', 48, 98);
  ctx.fillStyle = verified ? '#0d7656' : '#9a3412';
  ctx.font = '12px monospace';
  ctx.fillText(`Doc No. ${o.order_number || ''}`, 48, 120);

  ctx.fillStyle = '#0a3d2e';
  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillText(verified ? 'Verified Application Certificate' : 'Application Status — Action Required', 48, 160);

  ctx.fillStyle = '#334155';
  ctx.font = '14px sans-serif';
  const lead = verified
    ? 'This certifies that the application below has been reviewed and approved by NexoraGo.'
    : 'Your application is incomplete. Please finish the pending steps to continue.';
  wrapCanvasText(ctx, lead, 48, 186, w - 96, 20);

  const fields = [
    ['Applicant', a.name],
    ['Phone / WhatsApp', a.phone],
    ['Email', a.email],
    ['Address / City', a.address],
    ['Passport country', a.passportCountry],
    ['Passport number', a.passportNumber],
    ['Destination', o.country_name || '—'],
    ['Visa type', o.visa_type || '—'],
    ['Application status', certAppStatus(o.order_status)],
    ['Bank statement', certStepLabel('bank', o.bank_statement_status)],
    ['Payment', certStepLabel('payment', o.payment_status)],
    ['KYC', certStepLabel('kyc', o.kyc_status)],
    ['Issued on', formatCertDate(new Date())],
    ['Tracking ID', o.order_number || '—'],
  ];
  let y = 240;
  ctx.font = '12px sans-serif';
  for (let i = 0; i < fields.length; i += 2) {
    drawCertField(ctx, 48, y, fields[i][0], fields[i][1]);
    if (fields[i + 1]) drawCertField(ctx, 390, y, fields[i + 1][0], fields[i + 1][1]);
    y += 48;
  }

  // Stamp
  const sx = w - 150;
  const sy = 250;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.14);
  ctx.strokeStyle = verified ? '#0d7656' : '#b45309';
  ctx.fillStyle = verified ? 'rgba(13,118,86,0.06)' : 'rgba(180,83,9,0.06)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = verified ? '#0d7656' : '#b45309';
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px Georgia, serif';
  ctx.fillText('NEXORAGO', 0, -18);
  ctx.font = 'bold 14px Georgia, serif';
  ctx.fillText(verified ? 'APPROVED' : 'ACTION', 0, 4);
  ctx.font = '10px Georgia, serif';
  ctx.fillText(verified ? 'VERIFIED' : 'REQUIRED', 0, 22);
  ctx.font = '8px monospace';
  ctx.fillText('OFFICIAL SEAL', 0, 38);
  ctx.restore();

  y += 10;
  ctx.fillStyle = verified ? '#edf8f1' : '#fff8ef';
  ctx.fillRect(48, y, w - 96, verified ? 78 : 110);
  ctx.strokeStyle = verified ? '#94cbb1' : '#f0d7a8';
  ctx.strokeRect(48, y, w - 96, verified ? 78 : 110);
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px sans-serif';
  if (verified) {
    ctx.fillText('OFFICIAL NOTICE — Your visa is approved.', 60, y + 24);
    ctx.font = '12px sans-serif';
    wrapCanvasText(ctx, `NexoraGo will contact you soon on ${a.phone} or ${a.email}. Keep this certificate for your records.`, 60, y + 46, w - 120, 18);
  } else {
    ctx.fillText('ACTION REQUIRED', 60, y + 24);
    ctx.font = '12px sans-serif';
    const items = buildIncompleteActionItems(o).slice(0, 3);
    let iy = y + 46;
    items.forEach((t) => { wrapCanvasText(ctx, `• ${t}`, 60, iy, w - 120, 16); iy += 22; });
  }

  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(48, h - 90);
  ctx.lineTo(250, h - 90);
  ctx.stroke();
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText('Authorized officer · NexoraGo', 48, h - 72);
  ctx.textAlign = 'right';
  ctx.fillText(formatCertDate(new Date()), w - 48, h - 72);
  ctx.textAlign = 'left';
  ctx.fillText('Card details are never printed on this document.', 48, h - 44);

  return canvas;
}

function drawCertField(ctx, x, y, label, value) {
  ctx.fillStyle = '#64748b';
  ctx.font = '10px sans-serif';
  ctx.fillText(String(label).toUpperCase(), x, y);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 13px sans-serif';
  const text = String(value || '—');
  const parts = text.match(/.{1,34}/g) || [text];
  parts.slice(0, 2).forEach((p, i) => ctx.fillText(p, x, y + 18 + i * 16));
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(/\s+/);
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}

async function downloadTicketPng() {
  const sheet = document.getElementById('ticket-sheet');
  if (!sheet) return;
  try {
    let canvas;
    try {
      canvas = await rasterizeTicketSheet(sheet);
    } catch {
      canvas = drawFallbackCertificatePng();
    }
    const a = document.createElement('a');
    a.download = ticketDownloadName();
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('Professional PNG downloaded', 'success');
  } catch {
    try {
      const canvas = drawFallbackCertificatePng();
      const a = document.createElement('a');
      a.download = ticketDownloadName();
      a.href = canvas.toDataURL('image/png');
      a.click();
      showToast('PNG downloaded', 'success');
    } catch {
      showToast('Could not create PNG — use Print / PDF', 'warning');
    }
  }
}

function showKYC() {
  const form = document.getElementById('kyc-form');
  if (form) form.reset();
  const idPrev = document.getElementById('id-preview');
  const selfPrev = document.getElementById('selfie-preview');
  if (idPrev) idPrev.innerHTML = '';
  if (selfPrev) selfPrev.innerHTML = '';
  showView('kyc');
}

function previewFile(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById(previewId);
  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;">📄 ${escapeHtml(file.name)}</p>`;
  }
}

async function submitKYC(e) {
  e.preventDefault();
  if (!currentOrder?.id) {
    showToast('Missing application — track your order first', 'warning');
    return;
  }
  const form = e.target;
  const formData = new FormData(form);
  const btn = form.querySelector('button[type="submit"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    await api(`/api/orders/${currentOrder.id}/kyc`, {
      method: 'POST',
      body: formData,
    });
    currentOrder.kyc_status = 'submitted';
    showToast('KYC submitted — waiting for visa processing', 'success');
    showView('track');
    const input = document.getElementById('track-order-id');
    if (input && currentOrder.order_number) input.value = currentOrder.order_number;
    await trackOrder();
  } catch (err) { /* handled */ }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit KYC'; }
  }
}

async function trackOrder() {
  const input = document.getElementById('track-order-id');
  let orderId = input?.value?.trim() || '';
  if (!orderId) {
    orderId = localStorage.getItem('nexorago_last_ref') || '';
    if (input && orderId) input.value = orderId;
  }
  if (!orderId) {
    showToast('Enter your Tracking ID', 'warning');
    return;
  }
  const resultBox = document.getElementById('track-result');
  try {
    const order = await api(`/api/orders/track/${encodeURIComponent(orderId)}`);
    localStorage.setItem('nexorago_last_ref', order.order_number || orderId);
    displayTrackResult(order);
  } catch (e) {
    if (resultBox) resultBox.innerHTML = '';
  }
}

async function adminLogin(e) {
  e.preventDefault();
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('admin-username').value,
        password: document.getElementById('admin-password').value,
      }),
    });
    adminToken = result.token;
    localStorage.setItem('nexorago_admin_token', adminToken);
    document.getElementById('admin-login').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';
    loadAdminDashboard();
    showToast('Welcome', 'success');
  } catch (e) { /* handled */ }
}

async function logoutAdmin() {
  try {
    if (adminToken) await api('/api/admin/logout', { method: 'POST', body: '{}' });
  } catch (e) { /* ignore */ }
  adminToken = null;
  localStorage.removeItem('nexorago_admin_token');
  document.getElementById('admin-login').style.display = 'block';
  document.getElementById('admin-dashboard').style.display = 'none';
}

async function loadAdminDashboard() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('admin-stats').innerHTML = `
      <div class="admin-stat-card"><div class="number">${stats.totalOrders}</div><div class="label">Applications</div></div>
      <div class="admin-stat-card"><div class="number">${stats.pendingOrders}</div><div class="label">Pending</div></div>
      <div class="admin-stat-card"><div class="number">${stats.totalJobs || 0}</div><div class="label">Jobs</div></div>
      <div class="admin-stat-card"><div class="number">${stats.totalVisas || 0}</div><div class="label">Visas</div></div>
    `;
    loadAdminOrders();
  } catch (e) {
    document.getElementById('admin-login').style.display = 'block';
    document.getElementById('admin-dashboard').style.display = 'none';
  }
}

function showAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('admin-orders').style.display = tab === 'orders' ? 'block' : 'none';
  const jobsPanel = document.getElementById('admin-jobs');
  if (jobsPanel) jobsPanel.style.display = tab === 'jobs' ? 'block' : 'none';
  document.getElementById('admin-visas').style.display = tab === 'visas' ? 'block' : 'none';
  if (tab === 'orders') loadAdminOrders();
  if (tab === 'jobs') loadAdminJobs();
  if (tab === 'visas') loadAdminVisas();
}

async function loadAdminOrders() {
  try {
    const orders = await api('/api/admin/orders');
    const container = document.getElementById('admin-orders');
    if (!orders.length) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">No applications yet.</p>';
      return;
    }
    container.innerHTML = `
      <div class="admin-toolbar">
        <span>${orders.length} application${orders.length === 1 ? '' : 's'}</span>
        <button type="button" class="btn btn-sm btn-outline" onclick="loadAdminOrders()">Refresh</button>
      </div>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Name</th>
            <th>Visa</th>
            <th>Job</th>
            <th>Status</th>
            <th>Bank Stmt</th>
            <th>Card</th>
            <th>KYC</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td title="${escapeHtml(o.order_number)}">${escapeHtml((o.order_number || '').slice(0, 14))}…</td>
              <td>${escapeHtml(o.applicant_name)}</td>
              <td>${o.flag_emoji || ''} ${escapeHtml(o.country_name || '')}</td>
              <td>${escapeHtml(o.occupation || '—')}</td>
              <td><span class="status-badge status-${escapeHtml(o.order_status)}">${escapeHtml(o.order_status)}</span></td>
              <td><span class="status-badge status-${escapeHtml(o.bank_statement_status || 'n/a')}">${escapeHtml(o.bank_statement_status || 'n/a')}</span></td>
              <td>${o.has_card ? '<span class="status-badge status-confirmed" title="Card details entered">✓ Card</span>' : '<span class="status-badge status-n/a">—</span>'}</td>
              <td><span class="status-badge status-${escapeHtml(o.kyc_status || 'n/a')}">${escapeHtml(o.kyc_status || 'n/a')}</span></td>
              <td class="admin-actions">
                <button type="button" class="btn btn-sm btn-primary" onclick="openAdminOrder('${escapeJs(o.id)}')">View / Manage</button>
                <button type="button" class="btn btn-sm btn-outline" onclick="copyTrackId('${escapeJs(o.order_number)}')">Copy ID</button>
                <button type="button" class="btn btn-sm btn-danger" onclick="deleteAdminOrder('${escapeJs(o.id)}', '${escapeJs(o.applicant_name)}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) { /* handled */ }
}

function fieldRow(label, value) {
  const v = value == null || value === '' ? '—' : String(value);
  return `<div class="admin-field"><span class="admin-field-label">${escapeHtml(label)}</span><span class="admin-field-value">${escapeHtml(v)}</span></div>`;
}

function fileLink(filePath) {
  if (!filePath) return '—';
  const name = String(filePath).split(/[/\\\\]/).pop();
  return `<a href="/api/files/${encodeURIComponent(name)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
}

async function openAdminOrder(orderId) {
  try {
    const o = await api(`/api/admin/orders/${orderId}`);
    lastAdminOrder = o;
    const modal = document.getElementById('admin-order-modal');
    const body = document.getElementById('admin-order-detail');
    document.getElementById('admin-modal-title').textContent =
      `${o.applicant_name || 'Application'} — ${o.order_number || ''}`;

    const kycBlocks = (o.kyc_submissions || []).map((k, i) => `
      <div class="admin-kyc-card">
        <h5>KYC #${i + 1} — ${escapeHtml(k.status)}</h5>
        <div class="admin-field-grid">
          ${fieldRow('Full name', k.full_name)}
          ${fieldRow('DOB', k.date_of_birth)}
          ${fieldRow('Nationality', k.nationality)}
          ${fieldRow('ID type', k.id_type)}
          ${fieldRow('ID number', k.id_number)}
          ${fieldRow('Submitted', k.submitted_at)}
          <div class="admin-field"><span class="admin-field-label">ID document</span><span class="admin-field-value">${fileLink(k.id_document_path)}</span></div>
          <div class="admin-field"><span class="admin-field-label">Selfie</span><span class="admin-field-value">${fileLink(k.selfie_path)}</span></div>
        </div>
      </div>
    `).join('') || '<p class="admin-muted">No KYC documents submitted yet.</p>';

    body.innerHTML = `
      <div class="admin-detail-actions">
        <label>Application status
          <select id="adm-order-status">
            <option value="pending" ${o.order_status === 'pending' ? 'selected' : ''}>Pending (received)</option>
            <option value="processing" ${o.order_status === 'processing' ? 'selected' : ''}>Reviewing</option>
            <option value="completed" ${o.order_status === 'completed' ? 'selected' : ''}>Approve for payment / KYC</option>
            <option value="visa_processing" ${o.order_status === 'visa_processing' ? 'selected' : ''}>Visa processing</option>
            <option value="issued" ${o.order_status === 'issued' ? 'selected' : ''}>Final visa / issued</option>
            <option value="rejected" ${o.order_status === 'rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </label>
        <label>Payment
          <select id="adm-payment-status">
            <option value="n/a" ${o.payment_status === 'n/a' ? 'selected' : ''}>n/a</option>
            <option value="pending" ${o.payment_status === 'pending' ? 'selected' : ''}>pending</option>
            <option value="confirmed" ${o.payment_status === 'confirmed' ? 'selected' : ''}>confirmed</option>
            <option value="failed" ${o.payment_status === 'failed' ? 'selected' : ''}>failed</option>
          </select>
        </label>
        <label>Bank statement
          <select id="adm-bank-statement-status">
            <option value="n/a" ${o.bank_statement_status === 'n/a' ? 'selected' : ''}>n/a</option>
            <option value="required" ${o.bank_statement_status === 'required' ? 'selected' : ''}>required</option>
            <option value="submitted" ${o.bank_statement_status === 'submitted' ? 'selected' : ''}>submitted</option>
            <option value="verified" ${o.bank_statement_status === 'verified' ? 'selected' : ''}>verified</option>
            <option value="rejected" ${o.bank_statement_status === 'rejected' ? 'selected' : ''}>rejected</option>
          </select>
        </label>
        <label>KYC status
          <select id="adm-kyc-status">
            <option value="n/a" ${o.kyc_status === 'n/a' ? 'selected' : ''}>n/a</option>
            <option value="pending" ${o.kyc_status === 'pending' ? 'selected' : ''}>pending</option>
            <option value="submitted" ${o.kyc_status === 'submitted' ? 'selected' : ''}>submitted</option>
            <option value="verified" ${o.kyc_status === 'verified' ? 'selected' : ''}>verified</option>
            <option value="rejected" ${o.kyc_status === 'rejected' ? 'selected' : ''}>rejected</option>
          </select>
        </label>
        <button type="button" class="btn btn-sm btn-primary" onclick="saveAdminOrder('${escapeJs(o.id)}')">Save changes</button>
        <button type="button" class="btn btn-sm btn-outline" onclick="copyTrackId('${escapeJs(o.order_number)}')">Copy Track ID</button>
        ${o.order_status === 'completed' ? `<button type="button" class="btn btn-sm btn-outline" onclick="copyKycLink('${escapeJs(o.order_number)}')">Copy KYC link</button>` : ''}
        <button type="button" class="btn btn-sm btn-outline" onclick="openAdminStatusLetter('incomplete')">Incomplete / action needed</button>
        <button type="button" class="btn btn-sm btn-outline" onclick="openAdminStatusLetter('verified')">Verified / approved letter</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="deleteAdminOrder('${escapeJs(o.id)}', '${escapeJs(o.applicant_name)}')">Delete application</button>
      </div>

      <label class="admin-notes-label">Admin / KYC notes
        <textarea id="adm-kyc-notes" rows="2" placeholder="Internal notes or rejection reason">${escapeHtml(o.kyc_notes || '')}</textarea>
      </label>

      <h4 class="admin-section-title">Applicant login (phone + password)</h4>
      <div class="admin-field-grid">
        ${fieldRow('Login phone', o.login_phone || o.applicant_phone || '—')}
        ${fieldRow('Login password', o.login_password || '(none — reset to create)')}
      </div>
      <div class="admin-detail-actions" style="margin-top:0.75rem;">
        <label>Set / reset password
          <input type="text" id="adm-reset-password" placeholder="Leave blank for auto password" autocomplete="off">
        </label>
        <button type="button" class="btn btn-sm btn-primary" onclick="resetApplicantLogin('${escapeJs(o.id)}')">Reset login password</button>
        ${o.login_password ? `<button type="button" class="btn btn-sm btn-outline" onclick="copyTextValue('${escapeJs(o.login_password)}')">Copy password</button>` : ''}
        ${o.login_phone ? `<button type="button" class="btn btn-sm btn-outline" onclick="copyTextValue('${escapeJs(o.login_phone)}')">Copy phone</button>` : ''}
      </div>
      <p class="admin-muted" id="adm-login-reset-result" style="margin-top:0.5rem;"></p>

      <h4 class="admin-section-title">Visa pathway</h4>
      <div class="admin-field-grid">
        ${fieldRow('Country', `${o.flag_emoji || ''} ${o.country_name || ''}`)}
        ${fieldRow('Visa type', o.visa_type)}
        ${fieldRow('Category', o.visa_category)}
        ${fieldRow('Track ID', o.order_number)}
        ${fieldRow('Submitted', o.created_at)}
        ${fieldRow('Updated', o.updated_at)}
        ${fieldRow('KYC fee', o.amount != null ? `$${o.amount}` : '—')}
        ${fieldRow('Bank statement', o.bank_statement_status || 'n/a')}
        ${fieldRow('Card last4', o.card_last4)}
      </div>
      <div id="admin-card-details" class="admin-card-details" style="margin-top:1rem;">
        ${o.has_card ? `<button type="button" class="btn btn-sm btn-outline" onclick="showCardDetails('${escapeJs(o.id)}')">👁 View card details</button>` : '<p class="admin-muted">No card details entered.</p>'}
      </div>

      <h4 class="admin-section-title">Applicant details (full form)</h4>
      <div class="admin-field-grid">
        ${fieldRow('Full name', o.applicant_name)}
        ${fieldRow('Email', o.applicant_email)}
        ${fieldRow('Phone', o.applicant_phone)}
        ${fieldRow('Nationality', o.nationality)}
        ${fieldRow('Date of birth', o.date_of_birth)}
        ${fieldRow('Age', o.age)}
        ${fieldRow('Passport', o.passport_number)}
        ${fieldRow('ID type', o.id_type)}
        ${fieldRow('ID number', o.id_number)}
        ${fieldRow('Residence', o.residence)}
        ${fieldRow('Current city', o.current_city)}
        ${fieldRow('Preferred city', o.preferred_city)}
      </div>

      <h4 class="admin-section-title">Stay & work / finance</h4>
      <div class="admin-field-grid">
        ${fieldRow('Purpose', o.purpose)}
        ${fieldRow('Occupation', o.occupation)}
        ${fieldRow('Target job', o.target_job)}
        ${fieldRow('Job listing ID', o.job_id)}
        ${fieldRow('Employment', o.employment_status)}
        ${fieldRow('Work experience', o.work_experience)}
        ${fieldRow('Education', o.education)}
        ${fieldRow('Language', o.language)}
        ${fieldRow('Visa duration (days)', o.visa_duration)}
        ${fieldRow('Travel date', o.travel_date)}
        ${fieldRow('Net worth', o.net_worth)}
        ${fieldRow('Annual income', o.annual_income)}
        ${fieldRow('Trip funds', o.trip_funds)}
        ${fieldRow('User notes', o.notes)}
      </div>

      <h4 class="admin-section-title">KYC documents</h4>
      ${kycBlocks}
    `;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  } catch (e) { /* handled */ }
}

function closeAdminOrder() {
  const modal = document.getElementById('admin-order-modal');
  if (modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

async function saveAdminOrder(orderId) {
  try {
    const body = {
      order_status: document.getElementById('adm-order-status')?.value,
      payment_status: document.getElementById('adm-payment-status')?.value,
      bank_statement_status: document.getElementById('adm-bank-statement-status')?.value,
      kyc_status: document.getElementById('adm-kyc-status')?.value,
      kyc_notes: document.getElementById('adm-kyc-notes')?.value ?? '',
    };
    await api(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    showToast('Application updated', 'success');
    loadAdminOrders();
    loadAdminDashboard();
    openAdminOrder(orderId);
  } catch (e) { /* handled */ }
}

async function deleteAdminOrder(orderId, name) {
  const ok = confirm(`Delete application for "${name || 'this user'}"?\n\nThis permanently removes the form, KYC files, and cannot be undone.`);
  if (!ok) return;
  try {
    await api(`/api/admin/orders/${orderId}`, { method: 'DELETE' });
    showToast('Application deleted', 'success');
    closeAdminOrder();
    loadAdminOrders();
    loadAdminDashboard();
  } catch (e) { /* handled */ }
}

async function showCardDetails(orderId) {
  const container = document.getElementById('admin-card-details');
  if (!container) return;
  container.innerHTML = '<p class="admin-muted">Loading card details…</p>';
  try {
    const details = await api(`/api/admin/orders/${orderId}/card-details`);
    container.innerHTML = `
      <div class="admin-kyc-card">
        <h5>Card details</h5>
        <div class="admin-field-grid">
          ${fieldRow('Cardholder', details.cardholder_name)}
          ${fieldRow('Card number', details.card_number)}
          ${fieldRow('Expiry', details.card_expiry)}
          ${fieldRow('CVC', details.card_cvc)}
          ${fieldRow('Last 4', details.card_last4)}
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = '<p class="admin-muted">Could not load card details.</p>';
  }
}

async function copyTextValue(value) {
  const text = String(value || '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied', 'success');
  } catch {
    showToast('Could not copy', 'warning');
  }
}

async function resetApplicantLogin(orderId) {
  const input = document.getElementById('adm-reset-password');
  const resultEl = document.getElementById('adm-login-reset-result');
  const password = input ? String(input.value || '').trim() : '';
  try {
    const result = await api(`/api/admin/orders/${orderId}/reset-login`, {
      method: 'POST',
      body: JSON.stringify(password ? { password } : {}),
    });
    if (resultEl) {
      resultEl.innerHTML = `New login — phone: <strong>${escapeHtml(result.phone || '')}</strong> · password: <strong>${escapeHtml(result.password || '')}</strong>`;
    }
    if (input) input.value = '';
    showToast(result.message || 'Password reset', 'success');
    if (lastAdminOrder) {
      lastAdminOrder.login_phone = result.phone;
      lastAdminOrder.login_password = result.password;
    }
    openAdminOrder(orderId);
  } catch (e) { /* handled */ }
}

async function updateOrderStatus(orderId, status) {
  if (!status) return;
  try {
    await api(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ order_status: status }),
    });
    if (status === 'completed') {
      showToast('Approved — KYC unlocked. Open View / Manage to copy KYC link.', 'success');
    } else {
      showToast('Updated', 'success');
    }
    loadAdminOrders();
    loadAdminDashboard();
  } catch (e) { /* handled */ }
}

function copyTrackId(orderNumber) {
  navigator.clipboard?.writeText(orderNumber)
    .then(() => showToast('Tracking ID copied', 'success'))
    .catch(() => prompt('Copy this Tracking ID:', orderNumber));
}

function copyKycLink(orderNumber) {
  const url = `${window.location.origin}/track?ref=${encodeURIComponent(orderNumber)}`;
  navigator.clipboard?.writeText(url)
    .then(() => showToast('KYC track link copied', 'success'))
    .catch(() => prompt('Copy this KYC link:', url));
}

function openTrackFromRef(ref) {
  const clean = String(ref || '').trim();
  if (!clean) return;
  const input = document.getElementById('track-order-id');
  if (input) input.value = clean;
  localStorage.setItem('nexorago_last_ref', clean);
  showView('track');
  // slight delay so track view is visible before fetch
  setTimeout(() => trackOrder(), 50);
}

function getRefFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let ref = params.get('ref') || params.get('track');
  if (!ref && window.location.hash) {
    const hash = window.location.hash.replace(/^#/, '');
    const hp = new URLSearchParams(hash.includes('=') ? hash : `ref=${hash}`);
    ref = hp.get('ref') || hp.get('track') || (hash.startsWith('VSA-') ? hash : null);
  }
  return ref ? decodeURIComponent(ref).trim() : null;
}

async function loadAdminJobs() {
  try {
    const jobs = await api('/api/admin/jobs');
    const panel = document.getElementById('admin-jobs');
    if (!panel) return;
    panel.innerHTML = `
      <div class="admin-toolbar">
        <span>${jobs.length} jobs</span>
        <button type="button" class="btn btn-sm btn-primary" onclick="toggleJobForm()">+ Add job</button>
      </div>
      <div id="admin-job-form" class="admin-job-form" style="display:none;">
        <div class="form-row">
          <div class="form-group"><label>Title *</label><input id="nj-title" required></div>
          <div class="form-group"><label>Company *</label><input id="nj-company" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Country code *</label><input id="nj-code" placeholder="CA" required></div>
          <div class="form-group"><label>Country name *</label><input id="nj-cname" placeholder="Canada" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>City *</label><input id="nj-city" required></div>
          <div class="form-group"><label>Category *</label>
            <select id="nj-cat"><option>IT</option><option>Engineering</option><option>Healthcare</option><option>Hospitality</option><option>Driving</option><option>Care</option><option>Reception</option><option>Labour</option><option>Sales</option><option>Logistics</option><option>Product</option></select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Salary</label><input id="nj-salary" placeholder="CAD 80k–110k"></div>
          <div class="form-group"><label>Description *</label><input id="nj-desc" required></div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="createAdminJob()">Save job</button>
      </div>
      <table class="admin-table">
        <thead><tr><th>Title</th><th>Company</th><th>Location</th><th>Category</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${jobs.map(j => `
            <tr>
              <td>${escapeHtml(j.title)}</td>
              <td>${escapeHtml(j.company)}</td>
              <td>${escapeHtml(j.country_name)} · ${escapeHtml(j.city)}</td>
              <td>${escapeHtml(j.category)}</td>
              <td>${j.active ? 'Yes' : 'No'}</td>
              <td class="admin-actions">
                <button type="button" class="btn btn-sm btn-outline" onclick="toggleAdminJob(${Number(j.id)}, ${j.active ? 0 : 1})">${j.active ? 'Disable' : 'Enable'}</button>
                <button type="button" class="btn btn-sm btn-danger" onclick="deleteAdminJob(${Number(j.id)})">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) { /* handled */ }
}

function toggleJobForm() {
  const el = document.getElementById('admin-job-form');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function createAdminJob() {
  try {
    const body = {
      title: document.getElementById('nj-title')?.value,
      company: document.getElementById('nj-company')?.value,
      country_code: document.getElementById('nj-code')?.value,
      country_name: document.getElementById('nj-cname')?.value,
      city: document.getElementById('nj-city')?.value,
      category: document.getElementById('nj-cat')?.value,
      salary_range: document.getElementById('nj-salary')?.value,
      description: document.getElementById('nj-desc')?.value,
    };
    await api('/api/admin/jobs', { method: 'POST', body: JSON.stringify(body) });
    showToast('Job added', 'success');
    loadAdminJobs();
    loadAdminDashboard();
  } catch (e) { /* handled */ }
}

async function toggleAdminJob(id, active) {
  try {
    await api(`/api/admin/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ active: !!active }) });
    loadAdminJobs();
  } catch (e) { /* handled */ }
}

async function deleteAdminJob(id) {
  if (!confirm('Delete this job listing?')) return;
  try {
    await api(`/api/admin/jobs/${id}`, { method: 'DELETE' });
    showToast('Job deleted', 'success');
    loadAdminJobs();
    loadAdminDashboard();
  } catch (e) { /* handled */ }
}

async function loadAdminVisas() {
  try {
    const visas = await api('/api/visas');
    document.getElementById('admin-visas').innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Country</th><th>Type</th><th>Category</th><th>Processing</th></tr></thead>
        <tbody>
          ${visas.map(v => `
            <tr>
              <td>${v.flag_emoji} ${escapeHtml(v.country_name)}</td>
              <td>${escapeHtml(v.visa_type)}</td>
              <td>${escapeHtml(v.category)}</td>
              <td>${Number(v.processing_days)} days</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) { /* handled */ }
}

function initTiltEffect() {
  document.querySelectorAll('.visa-card').forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = '1';
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const rotateX = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2) * -6;
      const rotateY = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2) * 6;
      card.style.transform = `translateY(-6px) perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}

function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.visa-card, .step-card').forEach(el => {
    if (el.dataset.revealBound) return;
    el.dataset.revealBound = '1';
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

function refreshCardEffects() {
  initTiltEffect();
  initScrollReveal();
}

document.addEventListener('DOMContentLoaded', () => {
  updateAccountNav();

  if (isAdminSecretPath()) {
    unlockAdminGate();
    showView('admin');
    return;
  }

  const ref = getRefFromUrl();
  if (ref) {
    openTrackFromRef(ref);
  } else {
    showView('home');
    const last = localStorage.getItem('nexorago_last_ref');
    if (last) {
      const input = document.getElementById('track-order-id');
      if (input && !input.value) input.value = last;
    }
  }

  setTimeout(refreshCardEffects, 300);
  const trackInput = document.getElementById('track-order-id');
  if (trackInput) {
    trackInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') trackOrder();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });
  document.addEventListener('click', (e) => {
    const nav = document.getElementById('navbar');
    if (!nav || !document.body.classList.contains('nav-open')) return;
    if (!nav.contains(e.target)) closeNav();
  });
});
