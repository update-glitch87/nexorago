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
  data.nationality = data.nationality || data.passport_country || data.residence;
  data.residence = data.residence || data.passport_country || data.nationality;
  data.age = calcAge(data.date_of_birth);
  data.employment_status = data.employment_status || 'employed';
  data.language = data.language || 'fluent';
  data.trip_funds = data.trip_funds || '5k_10k';
  data.net_worth = data.net_worth || 'under_10k';
  data.annual_income = data.annual_income || 'under_15k';
  data.visa_duration = data.visa_duration || '365';
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
      <div class="summary-row"><span>Next step</span><span>NexoraGo review</span></div>
      <ol class="next-steps-list">
        <li>NexoraGo reviews your form</li>
        <li>When approved → pay processing fee</li>
        <li>Complete KYC documents</li>
        <li>Visa processing → final visa stage</li>
      </ol>
    `;

    const trackInput = document.getElementById('track-order-id');
    if (trackInput) trackInput.value = ref;

    form.reset();
    showToast('Submitted — please copy your Tracking ID', 'success');
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

  let stepIndex = 0;
  if (status === 'processing' || approved || visaProcessing || issued) stepIndex = 1;
  if (approved || paid || kycDone || visaProcessing || issued) stepIndex = 2;
  if (paid || kycDone || visaProcessing || issued) stepIndex = 3;
  if (kycDone || visaProcessing || issued) stepIndex = 4;
  if (visaProcessing || issued) stepIndex = 5;
  if (issued) stepIndex = 6;

  const steps = [
    { label: 'Received' },
    { label: 'Review' },
    { label: 'Payment' },
    { label: 'KYC' },
    { label: 'Processing' },
    { label: 'Final Visa' },
  ];

  let actionHtml = '';
  if (issued) {
    actionHtml = `
      <div class="track-action success-panel">
        <p><strong>Final visa stage</strong> — your file is marked as issued / complete.</p>
        <button class="btn btn-outline btn-full" onclick="openProcessingTicket()">View / Print Ticket</button>
      </div>`;
  } else if (visaProcessing) {
    actionHtml = `
      <div class="track-action">
        <p>KYC received. Your visa is <strong>in processing</strong>. We will update when the final visa stage is ready.</p>
        <button class="btn btn-outline btn-full" onclick="openProcessingTicket()">Download processing ticket</button>
      </div>`;
  } else if (!approved) {
    actionHtml = `
      <div class="track-action">
        <p>Status: <strong>Under review</strong>. When NexoraGo approves, <strong>bank statement upload</strong> unlocks here.</p>
      </div>`;
  } else if (bankNeedsUpload) {
    actionHtml = `
      <div class="track-action success-panel">
        <p><strong>Approved — upload bank statement</strong></p>
        <p>Please upload your latest bank statement. We will review it for <strong>20–30 seconds</strong>, then unlock payment.</p>
        <button class="btn btn-primary btn-full" onclick="showBankStatementUpload()">Upload bank statement →</button>
      </div>`;
  } else if (bankSubmitted) {
    const left = Math.max(1, Math.ceil((getBankReviewEndMs(order) - Date.now()) / 1000));
    actionHtml = `
      <div class="track-action review-panel">
        <p><strong>Reviewing your bank statement</strong></p>
        <p>Please wait while we verify your document. This usually takes <strong>20–30 seconds</strong>.</p>
        <div class="bank-review-wait">
          <div class="bank-review-spinner" aria-hidden="true"></div>
          <p>Checking… <strong id="bank-review-countdown">${left}</strong>s left</p>
        </div>
        <p class="form-hint">Do not close this page. Payment opens automatically after verification.</p>
      </div>`;
  } else if (!paid) {
    const isFailed = order.payment_status === 'failed';
    actionHtml = `
      <div class="track-action ${isFailed ? 'error-panel' : 'success-panel'}">
        <p><strong>${isFailed ? 'Payment failed' : 'Bank statement verified — pay now'}</strong></p>
        <p>${isFailed ? 'Your last payment attempt failed. You can retry with the same or a different card.' : `Pay <strong>$${Number(order.kyc_fee || 1)}</strong> processing / KYC fee, then upload KYC documents.`}</p>
        <button class="btn btn-primary btn-full" onclick="goToKycPayment()">${isFailed ? 'Retry payment' : `Pay $${Number(order.kyc_fee || 1)} &amp; continue →`}</button>
      </div>`;
  } else if (!kycDone) {
    actionHtml = `
      <div class="track-action success-panel">
        <p>Fee paid. Upload ID + selfie for KYC.</p>
        <button class="btn btn-primary btn-full" onclick="showKYC()">Upload KYC documents →</button>
        <button class="btn btn-outline btn-full" style="margin-top:0.5rem;" onclick="openProcessingTicket()">Download payment ticket</button>
      </div>`;
  } else {
    actionHtml = `
      <div class="track-action">
        <div class="summary-row"><span>Payment</span><span class="status-badge status-confirmed">paid</span></div>
        <div class="summary-row"><span>KYC</span><span class="status-badge status-${escapeHtml(order.kyc_status)}">${escapeHtml(order.kyc_status)}</span></div>
        <p style="margin-top:0.75rem;">Waiting for NexoraGo to move file to <strong>visa processing</strong> / final visa.</p>
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
      <div class="status-timeline steps-6">
        ${steps.map((s, i) => {
          const isFailedStep = order.payment_status === 'failed' && i === 2;
          return `
          <div class="timeline-step ${i < stepIndex ? 'completed' : ''} ${i === Math.min(stepIndex, steps.length - 1) ? 'active' : ''} ${isFailedStep ? 'failed' : ''}">
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
    showToast(`Paid $${fee} — ticket ready, then KYC`, 'success');
    openProcessingTicket({ afterPay: true });
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
    if (pay === 'failed') items.push('Card payment failed — retry the $100 processing fee from Track.');
    else if (['completed', 'visa_processing'].includes(st) || bank === 'verified' || bank === 'submitted') {
      items.push('Complete the $100 card payment so we can continue KYC verification.');
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
  const a = o.applicant || {};
  const name = a.name || o.applicant_name || '—';
  const phone = a.phone || '—';
  const email = a.email || '—';
  const address = a.address || '—';
  const passportCountry = a.passport_country || '—';
  const dest = `${o.flag_emoji || ''} ${o.country_name || ''}`.trim();
  const dateStr = new Date().toLocaleString();
  const isVerified = kind === 'verified';

  if (isVerified) {
    return `
      <div class="ticket-sheet status-letter status-verified" id="ticket-sheet" data-letter="verified">
        <div class="ticket-brand">NexoraGo</div>
        <div class="ticket-title">Verified Application Certificate</div>
        <div class="ticket-ref">${escapeHtml(o.order_number || '')}</div>
        <p class="ticket-lead">This confirms that your visa application has been fully verified by NexoraGo.</p>
        <div class="ticket-grid">
          <div><span>Applicant</span><strong>${escapeHtml(name)}</strong></div>
          <div><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>
          <div><span>Email</span><strong>${escapeHtml(email)}</strong></div>
          <div><span>Address</span><strong>${escapeHtml(address)}</strong></div>
          <div><span>Passport country</span><strong>${escapeHtml(passportCountry)}</strong></div>
          <div><span>Destination</span><strong>${escapeHtml(dest)}</strong></div>
          <div><span>Visa type</span><strong>${escapeHtml(o.visa_type || '')}</strong></div>
          <div><span>Application status</span><strong>${escapeHtml(statusLabel(o.order_status))}</strong></div>
          <div><span>Bank statement</span><strong>${escapeHtml(statusLabel(o.bank_statement_status))}</strong></div>
          <div><span>Payment</span><strong>${escapeHtml(statusLabel(o.payment_status))}</strong></div>
          <div><span>KYC</span><strong>${escapeHtml(statusLabel(o.kyc_status))}</strong></div>
          <div><span>Issued</span><strong>${escapeHtml(dateStr)}</strong></div>
        </div>
        <div class="ticket-why status-msg status-ok">
          <span>Official notice</span>
          <p><strong>Your visa is approved.</strong> Final embassy / filing steps are in progress. NexoraGo will contact you soon on your registered phone or email with the next instructions. Keep this letter for your records.</p>
        </div>
        <div class="ticket-footer">Card details are never printed on this letter. Track ID: ${escapeHtml(o.order_number || '')}</div>
      </div>
    `;
  }

  const actions = buildIncompleteActionItems(o);
  return `
    <div class="ticket-sheet status-letter status-incomplete" id="ticket-sheet" data-letter="incomplete">
      <div class="ticket-brand">NexoraGo</div>
      <div class="ticket-title">Application Status — Action Required</div>
      <div class="ticket-ref">${escapeHtml(o.order_number || '')}</div>
      <p class="ticket-lead">Your application is <strong>incomplete</strong>. Please finish the steps below so we can continue processing.</p>
      <div class="ticket-grid">
        <div><span>Applicant</span><strong>${escapeHtml(name)}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(email)}</strong></div>
        <div><span>Destination</span><strong>${escapeHtml(dest)}</strong></div>
        <div><span>Visa type</span><strong>${escapeHtml(o.visa_type || '')}</strong></div>
        <div><span>Application status</span><strong>${escapeHtml(statusLabel(o.order_status))}</strong></div>
        <div><span>Bank statement</span><strong>${escapeHtml(statusLabel(o.bank_statement_status))}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(statusLabel(o.payment_status))}</strong></div>
        <div><span>KYC</span><strong>${escapeHtml(statusLabel(o.kyc_status))}</strong></div>
        <div><span>Date</span><strong>${escapeHtml(dateStr)}</strong></div>
      </div>
      <div class="ticket-why status-msg status-warn">
        <span>What you still need to do</span>
        <ul class="status-action-list">
          ${actions.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
        </ul>
        <p>Open <strong>Track application</strong> on NexoraGo, enter Track ID <strong>${escapeHtml(o.order_number || '')}</strong>, and complete every pending step.</p>
      </div>
      <div class="ticket-footer">This notice excludes all card / payment instrument details. Send this PNG or PDF to the applicant as a reminder.</div>
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

function printTicketPdf() {
  const sheet = document.getElementById('ticket-sheet');
  if (!sheet) return;
  const w = window.open('', '_blank', 'noopener,noreferrer,width=720,height=900');
  if (!w) {
    showToast('Allow popups to print / save PDF', 'warning');
    return;
  }
  const title = lastTicketKind === 'verified'
    ? 'NexoraGo Verified Application'
    : lastTicketKind === 'incomplete'
      ? 'NexoraGo Application Status'
      : 'NexoraGo Ticket';
  w.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>
      body{font-family:Georgia,serif;padding:24px;color:#111}
      .ticket-brand{font-size:22px;font-weight:700}
      .ticket-title{font-size:18px;margin:8px 0}
      .ticket-ref{font-family:monospace;font-size:14px;margin-bottom:16px}
      .ticket-lead{margin:12px 0;line-height:1.45}
      .ticket-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
      .ticket-grid span{display:block;font-size:11px;color:#666;text-transform:uppercase}
      .ticket-why{border-top:1px solid #ddd;padding-top:12px;margin-top:12px}
      .ticket-why span{display:block;font-size:11px;color:#666;text-transform:uppercase;margin-bottom:6px}
      .status-action-list{margin:8px 0 12px 18px;padding:0}
      .status-action-list li{margin:6px 0}
      .status-ok{background:#f0faf3;padding:12px;border-radius:8px}
      .status-warn{background:#fff8ef;padding:12px;border-radius:8px}
      .ticket-footer{margin-top:20px;font-size:12px;color:#444}
    </style></head><body>${sheet.outerHTML}
    <script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

function getTicketPngLines() {
  if (lastTicketKind === 'incomplete' || lastTicketKind === 'verified') {
    const o = lastAdminOrder || {};
    const a = o.applicant || {};
    const name = a.name || o.applicant_name || '—';
    const lines = [
      `Applicant: ${name}`,
      `Phone: ${a.phone || '—'}`,
      `Email: ${a.email || '—'}`,
      `Destination: ${o.country_name || ''}`,
      `Visa: ${o.visa_type || ''}`,
      `Status: ${statusLabel(o.order_status)}`,
      `Bank statement: ${statusLabel(o.bank_statement_status)}`,
      `Payment: ${statusLabel(o.payment_status)}`,
      `KYC: ${statusLabel(o.kyc_status)}`,
      `Date: ${new Date().toLocaleString()}`,
      '',
    ];
    if (lastTicketKind === 'verified') {
      lines.push('NOTICE: Your visa is approved.');
      lines.push('We will contact you soon with next steps.');
      lines.push('Keep this verified letter for your records.');
    } else {
      lines.push('ACTION REQUIRED — application incomplete:');
      buildIncompleteActionItems(o).forEach((t) => lines.push(`• ${t}`));
      lines.push(`Track ID: ${o.order_number || ''}`);
    }
    lines.push('Card details are never included on this letter.');
    return {
      title: lastTicketKind === 'verified' ? 'Verified Application Certificate' : 'Application Status — Action Required',
      ref: o.order_number || '',
      lines,
      file: `${o.order_number || 'status'}-${lastTicketKind}.png`,
    };
  }

  const fee = Number(currentOrder?.kyc_fee || 0);
  let applicant = currentOrder?.applicant || lastApplicantSnapshot;
  try { if (!applicant) applicant = JSON.parse(localStorage.getItem('nexorago_last_applicant') || 'null'); } catch { /* */ }
  return {
    title: 'Payment & Processing Ticket',
    ref: currentOrder?.order_number || '',
    lines: [
      `Name: ${applicant?.name || currentOrder?.applicant_name || '—'}`,
      `Phone: ${applicant?.phone || '—'}`,
      `Email: ${applicant?.email || '—'}`,
      `Address: ${applicant?.address || '—'}`,
      `Passport country: ${applicant?.passport_country || '—'}`,
      `Destination: ${currentOrder?.country_name || ''}`,
      `Visa: ${currentOrder?.visa_type || ''}`,
      `Amount: $${fee} USD`,
      `Why: Processing & KYC verification for visa file handling`,
      `Date: ${new Date().toLocaleString()}`,
      'Keep for processing & final visa stage',
    ],
    file: `${currentOrder?.order_number || 'ticket'}.png`,
  };
}

async function downloadTicketPng() {
  const sheet = document.getElementById('ticket-sheet');
  if (!sheet) return;
  try {
    const payload = getTicketPngLines();
    const canvas = document.createElement('canvas');
    const scale = 2;
    const w = Math.max(sheet.offsetWidth, 420);
    const lineCount = payload.lines.length;
    const h = Math.max(sheet.offsetHeight, 160 + lineCount * 24);
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0a0e1a';
    ctx.font = 'bold 20px Georgia, serif';
    ctx.fillText('NexoraGo', 24, 36);
    ctx.font = '16px Georgia, serif';
    ctx.fillText(payload.title, 24, 62);
    ctx.font = '13px monospace';
    ctx.fillText(payload.ref, 24, 88);
    ctx.font = '13px sans-serif';
    let y = 120;
    for (const line of payload.lines) {
      const parts = String(line).match(/.{1,56}/g) || [line];
      for (const p of parts) {
        ctx.fillText(p, 24, y);
        y += 22;
      }
    }
    const a = document.createElement('a');
    a.download = payload.file;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast('PNG downloaded', 'success');
  } catch {
    showToast('Could not create PNG — use Print / PDF', 'warning');
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
    showToast('KYC submitted successfully', 'success');
    document.getElementById('success-details').innerHTML = `
      <div class="summary-row"><span>Reference</span><span style="font-family:monospace;">${escapeHtml(currentOrder.order_number)}</span></div>
      <div class="summary-row"><span>KYC</span><span>Submitted</span></div>
      <div class="summary-row"><span>Fee</span><span>Paid</span></div>
    `;
    showView('success');
    // restore success actions to track
    const actions = document.querySelector('#view-success .hero-actions');
    if (actions) {
      actions.innerHTML = `
        <button class="btn btn-primary" onclick="showView('track'); trackOrder();">Track Status</button>
        <button class="btn btn-outline" onclick="showView('home')">Home</button>
      `;
    }
  } catch (err) { /* handled */ }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit KYC'; }
  }
}

async function trackOrder() {
  const orderId = document.getElementById('track-order-id').value.trim();
  if (!orderId) {
    showToast('Enter your reference ID', 'warning');
    return;
  }
  const resultBox = document.getElementById('track-result');
  try {
    const order = await api(`/api/orders/track/${encodeURIComponent(orderId)}`);
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
