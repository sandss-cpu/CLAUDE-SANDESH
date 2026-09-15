/* Bato for bus owners: session, API, shared UI helpers, sign-in, navigation. */
'use strict';

const API = window.BATO_CONFIG?.api || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
const AUTH_KEY = 'bato.owner.auth';
const COMPANY_KEY = 'bato.owner.company';
const $ = (s, root = document) => root.querySelector(s);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
try{ const t = localStorage.getItem('bato.theme'); if(t === 'night') document.documentElement.dataset.theme = 'night'; }catch(_){}

/* ---------- labels ---------- */
const BUS_TYPE = {
  TOURIST_DELUXE: 'Tourist deluxe', SOFA_SEATER: 'Sofa seater', AC_DELUXE: 'AC deluxe', SLEEPER: 'Sleeper',
  MICRO_BUS: 'Micro bus', HIACE: 'Hiace', LOCAL: 'Local bus', MINI_BUS: 'Mini bus', OTHER: 'Other',
};
const AMENITY = {
  AC: 'Air conditioning', WIFI: 'Wi-Fi', CHARGING: 'Phone charging', RECLINING_SEATS: 'Reclining seats', TOILET: 'Toilet',
  WATER: 'Drinking water', TV: 'TV', CCTV: 'CCTV', FIRST_AID: 'First aid kit', GPS_TRACKING: 'GPS tracking',
  LUGGAGE_RACK: 'Luggage rack', BLANKETS: 'Blankets',
};
const BUS_STATUS = { ACTIVE: ['On the road', 'good'], IN_MAINTENANCE: ['In maintenance', 'warn'], OFF_ROAD: ['Off road', ''] };
const SERVICE_STATE = {
  OVERDUE: ['Service overdue', 'bad'], DUE_SOON: ['Service due soon', 'warn'], OK: ['Service up to date', 'good'], NO_RECORD: ['No service record', ''],
};
const EXPIRY = { EXPIRED: ['Expired', 'bad'], EXPIRING: ['Expiring soon', 'warn'], OK: ['Valid', 'good'], NONE: ['No expiry date', ''] };
const MAINT_KIND = {
  ROUTINE_SERVICE: 'Routine service', REPAIR: 'Repair', PARTS_REPLACEMENT: 'Parts replaced', INSPECTION: 'Inspection',
  TYRES: 'Tyres', BODYWORK: 'Bodywork', OTHER: 'Other work',
};
const INCIDENT_KIND = {
  BREAKDOWN: 'Breakdown', ACCIDENT: 'Accident', FLAT_TYRE: 'Flat tyre', ENGINE: 'Engine trouble', BRAKES: 'Brakes',
  ELECTRICAL: 'Electrical fault', OTHER: 'Other',
};
const SEVERITY = { MINOR: ['Minor', ''], MAJOR: ['Major', 'warn'], CRITICAL: ['Critical', 'bad'] };
const DOC_TYPE = {
  BLUEBOOK: 'Bluebook (registration)', ROUTE_PERMIT: 'Route permit', INSURANCE: 'Insurance',
  POLLUTION_CERTIFICATE: 'Pollution certificate', FITNESS_CERTIFICATE: 'Fitness certificate', TAX_CLEARANCE: 'Tax clearance', OTHER: 'Other document',
};
const DRIVER_ROLE = { DRIVER: 'Driver', CONDUCTOR: 'Conductor', HELPER: 'Helper' };
const VERIFICATION = {
  VERIFIED: ['Verified', 'good'], PENDING: ['Waiting for verification', 'warn'], REJECTED: ['Not approved', 'bad'], SUSPENDED: ['Suspended', 'bad'],
};
const REPORT_REASONS = [
  ['SPAM', 'Spam or fake'], ['HARASSMENT', 'Abusive or hateful'], ['MISINFORMATION', 'False or misleading'],
  ['SEXUAL_CONTENT', 'Sexual content'], ['ILLEGAL', 'Illegal or dangerous'], ['OTHER', 'Something else'],
];
const PARTS = [['cleanliness', 'Cleanliness'], ['driving', 'Safe driving'], ['punctuality', 'On time'], ['staff', 'Staff']];

/* ---------- state ---------- */
const state = {
  auth: null,
  login: freshLogin(),
  companies: [], companyId: null, company: null, unread: 0,
  routes: null, drivers: null,
  records: {},
  buses: { q: '', status: '', archived: false, page: 1 },
  feedback: { busId: '', rating: '', days: '', page: 1 },
  busReviewsPage: 1,
};
function freshLogin(){ return { step: 'signin', email: '', name: '', error: '', errorCode: '', notice: '', busy: false, devLink: '', challengeToken: '', resetToken: '' }; }

/* ---------- formatting ---------- */
const fmtDay = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const monthShort = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-IN');
const npr = (n) => n == null ? '—' : `NPR ${Number(n).toLocaleString('en-IN')}`;
const kmText = (n) => n == null ? '—' : `${Number(n).toLocaleString('en-IN')} km`;
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || `${w}s`)}`;
const stars = (n) => { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); };
const pill = ([label, tone]) => `<span class="pill ${tone || ''}">${esc(label)}</span>`;
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dayIso = (d) => d ? String(d).slice(0, 10) : '';
const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const isOwner = () => state.company?.role === 'OWNER';
const canManage = () => ['OWNER', 'MANAGER'].includes(state.company?.role);
const empty = (text) => `<div class="empty">${esc(text)}</div>`;

/* ---------- session ---------- */
function jwtExpiry(token){ try{ return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }catch(_){ return 0; } }
const tokenExpiresSoon = (t) => jwtExpiry(t) - Date.now() < 30_000;
function loadAuth(){ try{ state.auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }catch(_){ state.auth = null; } }
function saveAuth(data){
  state.auth = { accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user };
  localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth));
}

let refreshing = null;
/** One refresh at a time across tabs: a refresh token presented twice ends the whole session. */
function refreshSession(){
  if(refreshing) return refreshing;
  const run = async () => {
    const stored = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if(!stored?.refreshToken){ const e = new Error('signed out'); e.expired = true; throw e; }
    if(stored.accessToken !== state.auth?.accessToken && !tokenExpiresSoon(stored.accessToken)){ state.auth = stored; return stored; }
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    if(!res.ok){ const e = new Error('Could not refresh the session'); e.expired = res.status === 401; throw e; }
    const { data } = await res.json();
    state.auth = { ...stored, accessToken: data.accessToken, refreshToken: data.refreshToken };
    localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth));
    return state.auth;
  };
  refreshing = (navigator.locks ? navigator.locks.request('bato-owner-refresh', run) : run()).finally(() => { refreshing = null; });
  return refreshing;
}

async function authedFetch(url, opts = {}){
  const ended = () => { signOut('Your session ended. Please sign in again.'); const e = new Error('Session ended'); e.silent = true; return e; };
  if(!state.auth) throw ended();
  if(tokenExpiresSoon(state.auth.accessToken)){
    try{ await refreshSession(); }catch(err){ if(err.expired) throw ended(); }
  }
  const call = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${state.auth.accessToken}` } });
  let res = await call();
  if(res.status === 401){
    try{ await refreshSession(); }catch(err){ if(err.expired) throw ended(); throw err; }
    res = await call();
    if(res.status === 401) throw ended();
  }
  return res;
}

async function readJson(res){
  const json = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error(json?.message || 'Something went wrong. Please try again.');
    err.status = res.status; err.code = json?.code;
    throw err;
  }
  return json.data;
}

async function api(path, { method = 'GET', body } = {}){
  const form = body instanceof FormData;
  let res;
  try{
    res = await authedFetch(`${API}${path}`, {
      method, headers: form ? {} : { 'Content-Type': 'application/json' },
      body: form ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  }catch(err){
    if(err.silent) throw err;
    throw new Error('Bato is not reachable. Check your internet connection and try again.');
  }
  return readJson(res);
}

async function publicPost(path, body){
  let res;
  try{
    res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }catch(_){
    throw new Error('Bato is not reachable. Check your internet connection and try again.');
  }
  return readJson(res);
}

function signOut(message){
  const auth = state.auth;
  state.auth = null; state.companies = []; state.company = null; state.companyId = null; state.drivers = null;
  localStorage.removeItem(AUTH_KEY);
  state.login = { ...freshLogin(), error: message || '' };
  showAuth();
  if(auth?.refreshToken){
    fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.refreshToken }) }).catch(() => {});
  }
}

/* ---------- notices and dialogs ---------- */
let noticeTimer = null;
function notify(message, kind = 'ok'){
  let box = document.getElementById('notice');
  if(!box){
    box = document.createElement('div'); box.id = 'notice'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  box.className = `notice ${kind}`; box.textContent = message; box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6500 : 3500);
}

/** Confirmation with optional text field. Resolves to the text (or true), or null when cancelled. */
function askDialog({ title, message = '', confirmLabel = 'Confirm', danger = false, field = null }){
  return openForm({
    title, intro: message, submitLabel: confirmLabel, danger,
    fields: field ? [{ name: 'value', full: true, ...field }] : [],
    values: field ? { value: field.value ?? '' } : {},
    onSubmit: async (v) => (field ? (v.value ?? '') : true),
  });
}

/* ---------- generic form dialog ---------- */
function fieldHtml(f, value){
  const id = `f-${f.name}`;
  const req = f.required ? ' <span aria-hidden="true" style="color:var(--rhodo)">*</span>' : '';
  const label = f.type === 'checkbox' ? '' : `<label for="${id}">${esc(f.label)}${req}</label>`;
  const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
  const attrs = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}
    ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}`;
  let control;
  switch(f.type){
    case 'select':
      control = `<select ${attrs}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      break;
    case 'textarea':
      control = `<textarea ${attrs} style="${f.rows ? `min-height:${f.rows * 24}px` : ''}">${esc(value ?? '')}</textarea>`;
      break;
    case 'checkbox':
      control = `<label class="check"><input type="checkbox" ${attrs} ${value ? 'checked' : ''}> ${esc(f.label)}</label>`;
      break;
    case 'chips':
      control = `<div class="chipset" role="group" aria-label="${esc(f.label)}">${f.options.map(([v, l]) =>
        `<label><input type="checkbox" name="${f.name}" value="${esc(v)}" ${(value || []).includes(v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
      break;
    case 'photos': case 'photo':
      control = `<div class="photos" data-photos="${f.name}"></div>`;
      break;
    case 'tags':
      control = `<input type="text" ${attrs} value="${esc((value || []).join(', '))}">`;
      break;
    default:
      control = `<input type="${f.type || 'text'}" ${attrs} value="${esc(value ?? '')}" ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
  }
  return `<div class="field ${f.full ? 'full' : ''}">${label}${control}${hint}</div>`;
}

function openForm({ title, intro = '', fields, values = {}, submitLabel = 'Save', danger = false, wide = false, onSubmit }){
  return new Promise((resolve) => {
    const photos = {};
    for(const f of fields) if(f.type === 'photos' || f.type === 'photo') photos[f.name] = [].concat(values[f.name] || []).filter(Boolean);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <form class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="fm-title" novalidate>
        <div class="modal-head"><h2 id="fm-title">${esc(title)}</h2><button type="button" class="icon-btn" data-cancel aria-label="Close">×</button></div>
        ${intro ? `<p class="muted" style="margin:0">${esc(intro)}</p>` : ''}
        ${fields.length ? `<div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>` : ''}
        <div class="error" role="alert" hidden></div>
        <div class="modal-actions">
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(submitLabel)}</button>
          <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    const form = back.querySelector('form');
    const errorBox = back.querySelector('.error');
    const returnFocus = document.activeElement;
    const close = (value) => { back.remove(); returnFocus?.focus?.(); resolve(value); };

    const paintPhotos = (name) => {
      const f = fields.find((x) => x.name === name);
      const max = f.type === 'photo' ? 1 : (f.max || 10);
      const box = back.querySelector(`[data-photos="${name}"]`);
      box.innerHTML = photos[name].map((url, i) => `
        <div class="photo"><img src="${esc(url)}" alt="Photo ${i + 1}"><button type="button" aria-label="Remove photo ${i + 1}" data-remove="${name}:${i}">×</button></div>`).join('')
        + (photos[name].length < max ? `<label class="upload">+ ${f.type === 'photo' ? 'Photo' : 'Photos'}
            <input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" ${max > 1 ? 'multiple' : ''} data-upload="${name}"></label>` : '');
    };
    Object.keys(photos).forEach(paintPhotos);

    back.addEventListener('click', async (e) => {
      if(e.target === back || e.target.closest('[data-cancel]')) return close(null);
      const rm = e.target.closest('[data-remove]');
      if(rm){ const [name, i] = rm.dataset.remove.split(':'); photos[name].splice(Number(i), 1); paintPhotos(name); }
    });
    back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(null); });
    back.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-upload]');
      if(!input?.files?.length) return;
      const name = input.dataset.upload;
      const f = fields.find((x) => x.name === name);
      const max = f.type === 'photo' ? 1 : (f.max || 10);
      const files = [...input.files].slice(0, max - photos[name].length);
      const label = input.closest('.upload');
      label.firstChild.textContent = 'Uploading…';
      try{
        photos[name].push(...await uploadImages(files));
        errorBox.hidden = true;
      }catch(err){
        errorBox.textContent = err.message; errorBox.hidden = false;
      }
      paintPhotos(name);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = {};
      for(const f of fields){
        if(f.type === 'photos') { v[f.name] = photos[f.name]; continue; }
        if(f.type === 'photo') { v[f.name] = photos[f.name][0] || ''; continue; }
        if(f.type === 'chips') { v[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((i) => i.value); continue; }
        const el = form.elements[f.name];
        if(f.type === 'checkbox') { v[f.name] = el.checked; continue; }
        const raw = el.value.trim();
        if(f.required && !raw){
          errorBox.textContent = `${f.label} is required.`; errorBox.hidden = false; el.focus(); return;
        }
        if(f.type === 'number') v[f.name] = raw === '' ? undefined : Number(raw);
        else if(f.type === 'tags') v[f.name] = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        else v[f.name] = raw;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      errorBox.hidden = true;
      try{
        const result = await onSubmit(v);
        close(result === undefined ? true : result);
      }catch(err){
        submit.disabled = false;
        if(err.silent){ close(null); return; }
        errorBox.textContent = err.message; errorBox.hidden = false;
      }
    });

    document.body.appendChild(back);
    (form.querySelector('input:not([type=file]),select,textarea') || form.querySelector('button[type="submit"]')).focus();
  });
}

/* ---------- photo uploads: resized on the phone first, for slow connections ---------- */
async function prepareImage(file, maxDim = 1600){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 350_000) return file;
  try{
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  }catch(_){ return file; }
}
async function uploadImages(files){
  if(!files.length) return [];
  const fd = new FormData();
  for(const f of files) fd.append('files', await prepareImage(f));
  const data = await api('/media/upload', { method: 'POST', body: fd });
  if(data.rejectedCount) notify(`${plural(data.rejectedCount, 'file')} skipped: not a real image.`, 'error');
  return data.files.map((f) => f.url);
}

/* ---------- small building blocks ---------- */
const pageHead = (title, sub, actions = '') => `
  <div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div>
  ${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;

function verificationBanner(){
  const c = state.company;
  if(!c || c.verification === 'VERIFIED') return '';
  const note = c.verificationNote ? ` Note from Bato: ${esc(c.verificationNote)}` : '';
  if(c.verification === 'PENDING'){
    return `<div class="banner warn" role="status"><span aria-hidden="true">⏳</span><div><b>Bato is verifying ${esc(c.name)}</b>
      You can add buses and records now. Passengers see your buses, and their QR codes start working, once you are verified, usually within two working days.${note}</div></div>`;
  }
  if(c.verification === 'REJECTED'){
    return `<div class="banner bad" role="alert"><span aria-hidden="true">✕</span><div><b>Verification was not approved</b>
      Update your company details and they will be checked again.${note} <a href="#company">Open company details</a></div></div>`;
  }
  return `<div class="banner bad" role="alert"><span aria-hidden="true">⏸</span><div><b>${esc(c.name)} is suspended</b>
    Your buses are hidden from passengers and their QR codes are paused. Contact Bato support.${note}</div></div>`;
}

function kpi(icon, label, value, detail, onclick, tone = ''){
  const inner = `<div class="k-label"><span aria-hidden="true">${icon}</span>${esc(label)}</div>
    <div class="k-value">${value}</div><div class="k-detail">${detail}</div>`;
  return onclick ? `<button class="kpi ${tone}" onclick="${onclick}">${inner}</button>` : `<div class="kpi ${tone}">${inner}</div>`;
}

function distribution(dist){
  const max = Math.max(1, ...dist.map((d) => d.count));
  return dist.map((d) => `<div class="dist-row"><span>${d.stars}★</span><div class="bar"><span style="width:${Math.round((d.count / max) * 100)}%"></span></div><span>${d.count}</span></div>`).join('');
}
function partsGrid(parts){
  const items = PARTS.filter(([k]) => parts?.[k] != null);
  return items.length ? `<div class="parts">${items.map(([k, l]) => `<div class="part"><b>${parts[k].toFixed(1)}</b>${l}</div>`).join('')}</div>` : '';
}
function columns(items, { value, label, text, max }){
  if(!items.length) return empty('Nothing to show yet.');
  const top = max ?? Math.max(1, ...items.map(value));
  return `<div class="columns" role="img" aria-label="${esc(items.map((i) => `${label(i)}: ${text(i)}`).join(', '))}">
    ${items.map((i) => `<div class="col"><span class="col-val">${esc(text(i))}</span>
      <div class="col-bar"><i style="height:${Math.max(2, Math.round((value(i) / top) * 100))}%"></i></div>
      <span class="col-lbl">${esc(label(i))}</span></div>`).join('')}
  </div>`;
}

/* ---------- sign in ---------- */
const AUTH_VIEWS = {
  signin: (l) => `
    <h2>Sign in</h2>
    <p class="muted">Manage your buses, records and passenger feedback.</p>
    <form onsubmit="authSignIn(event)" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username" inputmode="email" required value="${esc(l.email)}"></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required></div>
      ${authAlerts(l)}
      <button class="btn btn-primary" type="submit" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <div class="auth-links">
      <button class="link" onclick="authGo('forgot')">Forgot password?</button>
      <button class="link" onclick="authGo('register')">New to Bato? Create an account</button>
    </div>
    <p class="muted small" style="margin-top:22px">Travelling rather than running buses? <a href="login.html">Traveller sign-in</a> · <a href="bus.html">Rate a bus</a></p>`,
  register: (l) => `
    <h2>Create your owner account</h2>
    <p class="muted">Free for individual owners and bus companies. We'll email you a link to confirm your address.</p>
    <form onsubmit="authRegister(event)" novalidate>
      <div class="field"><label for="name">Your name</label><input id="name" autocomplete="name" required minlength="2" maxlength="60" value="${esc(l.name)}"></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email" required value="${esc(l.email)}"></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="new-password" minlength="8" required>
        <div class="hint">At least 8 characters.</div></div>
      ${authAlerts(l)}
      <button class="btn btn-primary" type="submit" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Creating account…' : 'Create account'}</button>
    </form>
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Already have an account? Sign in</button></div>`,
  sent: (l) => `
    <h2>Check your inbox</h2>
    <p class="muted">If <strong>${esc(l.email)}</strong> can be used, a confirmation link is on its way. Check spam too.</p>
    ${devLinkCard(l)}${authAlerts(l)}
    <button class="btn btn-ghost" onclick="authResend()" ${l.busy ? 'disabled' : ''}>Send the link again</button>
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Back to sign in</button></div>`,
  forgot: (l) => `
    <h2>Reset your password</h2>
    <form onsubmit="authForgot(event)" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required value="${esc(l.email)}"></div>
      ${authAlerts(l)}
      <button class="btn btn-primary" type="submit" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Sending…' : 'Send reset link'}</button>
    </form>
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Back to sign in</button></div>`,
  forgotSent: (l) => `
    <h2>Check your inbox</h2>
    <p class="muted">If an account uses <strong>${esc(l.email)}</strong>, a reset link is on its way. It expires in 1 hour.</p>
    ${devLinkCard(l)}
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Back to sign in</button></div>`,
  reset: (l) => `
    <h2>Choose a new password</h2>
    <p class="muted">You'll be signed out on every other device.</p>
    <form onsubmit="authReset(event)" novalidate>
      <div class="field"><label for="password">New password</label><input id="password" type="password" autocomplete="new-password" minlength="8" required></div>
      ${authAlerts(l)}
      <button class="btn btn-primary" type="submit" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Saving…' : 'Save new password'}</button>
    </form>`,
  mfa: (l) => `
    <h2>Authenticator code</h2>
    <p class="muted">This account can also manage Bato itself, so it needs the 6-digit code from your authenticator app.</p>
    <form onsubmit="authMfa(event)" novalidate>
      <div class="field"><label for="code">6-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
      ${authAlerts(l)}
      <button class="btn btn-primary" type="submit" ${l.busy ? 'disabled' : ''}>${l.busy ? 'Checking…' : 'Sign in'}</button>
    </form>
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Use a different account</button></div>`,
  mfaSetup: () => `
    <h2>Set up your authenticator first</h2>
    <p class="muted">This account can manage Bato itself. Set up an authenticator app once in the control panel, then sign in here.</p>
    <a class="btn btn-primary" href="admin.html">Open the control panel</a>
    <div class="auth-links"><button class="link" onclick="authGo('signin')">Use a different account</button></div>`,
  working: (l) => `<h2>${esc(l.notice || 'One moment…')}</h2><div class="spinner" role="status" aria-label="Loading"></div>`,
  linkFailed: (l) => `
    <h2>That link didn't work</h2>
    <div class="error" role="alert">${esc(l.error)}</div>
    <button class="btn btn-primary" onclick="authGo('signin')">Back to sign in</button>`,
};

function authAlerts(l){
  return `${l.error ? `<div class="error" role="alert">${esc(l.error)}
      ${l.errorCode === 'EMAIL_NOT_VERIFIED' ? '<div><button class="link" type="button" onclick="authResend()">Send the confirmation link again</button></div>' : ''}</div>` : ''}
    ${l.notice ? `<div class="ok" role="status">${esc(l.notice)}</div>` : ''}`;
}
function devLinkCard(l){
  return l.devLink ? `<div class="ok"><strong>Development mode:</strong> no email service is configured, so here is the link that would have been emailed.
    <a class="devlink" href="${esc(l.devLink)}">Open the link</a></div>` : '';
}

function showAuth(){
  $('#app').hidden = true;
  const view = $('#auth-view');
  view.hidden = false;
  view.innerHTML = `
    <div class="auth">
      <section class="auth-brand">
        <div>
          <div class="logo">Bato<span>for bus owners</span></div>
          <h1>Your whole fleet, and what passengers think of it.</h1>
          <ul>
            <li><b>🚌</b><span>Register every bus by its registration number, from one bus to hundreds.</span></li>
            <li><b>★</b><span>Read reviews and suggestions for each bus, and reply to passengers.</span></li>
            <li><b>🔧</b><span>Keep service history with kilometre readings and photos, and get reminded before service is due.</span></li>
            <li><b>📄</b><span>Never miss an insurance, permit or licence renewal.</span></li>
            <li><b>▦</b><span>A unique QR code for every bus, so passengers can rate the exact bus they rode.</span></li>
          </ul>
        </div>
        <div class="flags" aria-hidden="true"><i style="background:#2F6FD0"></i><i style="background:#FDFAF3"></i><i style="background:#E8455F"></i><i style="background:#3E9B4F"></i><i style="background:#F4A024"></i></div>
      </section>
      <section class="auth-form"><div class="auth-card" id="auth-card" aria-live="polite"></div></section>
    </div>`;
  renderAuth();
}
function renderAuth(){
  const card = $('#auth-card');
  if(!card) return showAuth();
  card.innerHTML = AUTH_VIEWS[state.login.step](state.login);
}
function authGo(step, patch = {}){
  const keepEmail = $('#email')?.value ?? state.login.email;
  state.login = { ...freshLogin(), email: keepEmail, ...patch, step };
  renderAuth();
  $('#auth-card input')?.focus();
}
function authBusy(){ Object.assign(state.login, { busy: true, error: '', errorCode: '', notice: '' }); renderAuth(); }
function authFail(err){ Object.assign(state.login, { busy: false, error: err.message, errorCode: err.code || '' }); renderAuth(); }

async function authSignIn(e){
  e.preventDefault();
  const email = $('#email').value.trim(); const password = $('#password').value;
  if(!email || !password){ state.login.error = 'Enter your email and password.'; renderAuth(); return; }
  state.login.email = email; authBusy();
  try{ await finishSignIn(await publicPost('/auth/email/login', { email, password })); }catch(err){ authFail(err); }
}
async function authRegister(e){
  e.preventDefault();
  const name = $('#name').value.trim(); const email = $('#email').value.trim(); const password = $('#password').value;
  Object.assign(state.login, { name, email });
  if(name.length < 2){ state.login.error = 'Enter your name.'; renderAuth(); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ state.login.error = 'Enter a valid email address.'; renderAuth(); return; }
  if(password.length < 8){ state.login.error = 'Use at least 8 characters for your password.'; renderAuth(); return; }
  authBusy();
  try{
    const data = await publicPost('/auth/email/register', { name, email, password, app: 'owner' });
    authGo('sent', { email, devLink: data.devLink || '' });
  }catch(err){ authFail(err); }
}
async function authResend(){
  const email = state.login.email || $('#email')?.value;
  authBusy();
  try{
    const data = await publicPost('/auth/email/resend', { email, app: 'owner' });
    authGo('sent', { email, devLink: data.devLink || '', notice: 'A new link is on its way.' });
  }catch(err){ authFail(err); }
}
async function authForgot(e){
  e.preventDefault();
  const email = $('#email').value.trim();
  state.login.email = email; authBusy();
  try{
    const data = await publicPost('/auth/password/forgot', { email, app: 'owner' });
    authGo('forgotSent', { email, devLink: data.devLink || '' });
  }catch(err){ authFail(err); }
}
async function authReset(e){
  e.preventDefault();
  const password = $('#password').value;
  if(password.length < 8){ state.login.error = 'Use at least 8 characters for your password.'; renderAuth(); return; }
  const token = state.login.resetToken; authBusy();
  try{
    const data = await publicPost('/auth/password/reset', { token, password });
    authGo('signin', { notice: data.message });
  }catch(err){
    if(err.status === 400 && /link/i.test(err.message)) authGo('linkFailed', { error: err.message }); else authFail(err);
  }
}
async function authMfa(e){
  e.preventDefault();
  const code = $('#code').value.trim();
  if(!/^\d{6}$/.test(code)){ state.login.error = 'Enter the 6 digits from your authenticator app.'; renderAuth(); return; }
  const challengeToken = state.login.challengeToken; authBusy();
  try{ await finishSignIn(await publicPost('/auth/mfa/verify', { challengeToken, code })); }
  catch(err){
    if(err.status === 401 && /expired/i.test(err.message)) authGo('signin', { error: 'That took too long. Sign in again.' }); else authFail(err);
  }
}
async function finishSignIn(data){
  if(data.mfaEnrolmentRequired){ authGo('mfaSetup'); return; }
  if(data.mfaRequired){ authGo('mfa', { challengeToken: data.challengeToken }); return; }
  saveAuth(data);
  state.login = freshLogin();
  await bootApp();
}

/* ---------- companies and navigation ---------- */
const NAV = [
  ['dashboard', 'Dashboard', '▦'], ['buses', 'Buses', '🚌'], ['feedback', 'Feedback', '★'],
  ['crew', 'Crew', '👤'], ['reminders', 'Reminders', '🔔'], ['company', 'Company', '🏢'],
];

async function bootApp(){
  $('#auth-view').hidden = true;
  $('#app').hidden = false;
  $('#side').innerHTML = '';
  $('#main').innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>';
  try{
    state.companies = await api('/fleet/companies');
  }catch(err){
    if(err.silent) return;
    $('#main').innerHTML = `<div class="panel" style="max-width:520px;margin:40px auto">
      <h2>Couldn't load your account</h2><div class="error" role="alert">${esc(err.message)}</div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="bootApp()">Try again</button><button class="btn btn-ghost" onclick="signOut()">Sign out</button></div></div>`;
    return;
  }
  const saved = localStorage.getItem(COMPANY_KEY);
  const pick = state.companies.find((c) => c.id === saved) || state.companies[0];
  if(!pick){ state.company = null; state.companyId = null; renderShell(); location.hash = '#onboard'; renderApp(); return; }
  await selectCompany(pick.id, false);
}

async function selectCompany(id, navigate = true){
  state.companyId = id;
  localStorage.setItem(COMPANY_KEY, id);
  state.drivers = null; state.records = {};
  state.buses = { q: '', status: '', archived: false, page: 1 };
  state.feedback = { busId: '', rating: '', days: '', page: 1 };
  try{
    state.company = await api(`/fleet/companies/${id}`);
  }catch(err){
    if(err.silent) return;
    notify(err.message, 'error');
    return;
  }
  refreshUnread();
  renderShell();
  if(navigate || !location.hash || location.hash === '#onboard') go('dashboard'); else renderApp();
}

async function refreshUnread(){
  try{
    const data = await api(`/fleet/companies/${state.companyId}/notifications`);
    state.unread = data.unread;
    renderShell();
  }catch(_){}
}

function switchCompany(value){
  if(value === '__new'){ go('onboard'); renderShell(); return; }
  selectCompany(value);
}

function renderShell(){
  const { screen } = parseHash();
  const c = state.company;
  const companyBox = state.companies.length ? `
    <div class="company-box">
      <label for="companySelect" class="sr-only">Company</label>
      <select id="companySelect" onchange="switchCompany(this.value)">
        ${state.companies.map((x) => `<option value="${esc(x.id)}" ${x.id === state.companyId && screen !== 'onboard' ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        <option value="__new" ${screen === 'onboard' ? 'selected' : ''}>+ Register another company</option>
      </select>
      ${c ? `<div class="who"><span>${c.role === 'OWNER' ? 'Owner' : 'Manager'}</span><span>${pill(VERIFICATION[c.verification])}</span></div>` : ''}
    </div>` : '';
  $('#side').innerHTML = `
    <div class="side-top">
      <a class="logo" href="#dashboard">Bato<span>for bus owners</span></a>
      ${companyBox}
    </div>
    ${c ? `<nav aria-label="Owner portal">
      ${NAV.map(([key, label, icon]) => `<a href="#${key}" ${screen === key || (key === 'buses' && screen === 'bus') ? 'aria-current="page"' : ''}>
        <span class="ico" aria-hidden="true">${icon}</span>${label}
        ${key === 'reminders' && state.unread ? `<span class="badge" aria-label="${state.unread} unread">${state.unread}</span>` : ''}</a>`).join('')}
    </nav>` : ''}
    <div class="side-foot">
      <span>${esc(state.auth?.user?.name || '')}</span>
      <a href="bus.html" target="_blank" rel="noopener">Passenger bus page ↗</a>
      <button onclick="toggleTheme()">${document.documentElement.dataset.theme === 'night' ? '☀ Light mode' : '🌙 Dark mode'}</button>
      <button onclick="signOut()">Sign out</button>
    </div>`;
  if(window.innerWidth <= 900 && c){
    const nav = $('#side nav');
    if(nav && !$('#side .mobile-out')){
      nav.insertAdjacentHTML('beforeend', `<a href="#" class="mobile-out" onclick="event.preventDefault();signOut()"><span class="ico" aria-hidden="true">⎋</span>Sign out</a>`);
    }
  }
}

function toggleTheme(){
  const night = document.documentElement.dataset.theme !== 'night';
  document.documentElement.dataset.theme = night ? 'night' : 'day';
  try{ localStorage.setItem('bato.theme', night ? 'night' : 'day'); }catch(_){}
  renderShell();
}

function parseHash(){
  const [screen, id, tab] = location.hash.replace(/^#/, '').split('/');
  return { screen: screen || 'dashboard', id, tab };
}
function go(hash){
  if(location.hash === `#${hash}`) renderApp(); else location.hash = hash;
}

let renderSeq = 0;
async function renderApp(){
  if(!state.auth) return;
  let { screen, id, tab } = parseHash();
  if(!state.company && screen !== 'onboard'){ if(!state.companies.length){ location.hash = '#onboard'; return; } }
  if(!SCREENS[screen]) screen = 'dashboard';
  renderShell();
  const main = $('#main');
  const seq = ++renderSeq;
  main.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>';
  try{
    const html = await SCREENS[screen]({ id, tab });
    if(seq !== renderSeq) return;
    main.innerHTML = html;
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }catch(err){
    if(seq !== renderSeq || err.silent) return;
    main.innerHTML = `<div class="panel" style="max-width:560px;margin:30px auto">
      <h2>${err.status === 404 ? 'Not found' : 'Something went wrong'}</h2>
      <div class="error" role="alert">${esc(err.message)}</div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="renderApp()">Try again</button><a class="btn btn-ghost" href="#dashboard">Dashboard</a></div></div>`;
  }
}
window.addEventListener('hashchange', () => { if(state.auth) renderApp(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.auth && renderShell(), 200); });

const SCREENS = {};

async function loadRoutes(){
  if(!state.routes){
    try{ state.routes = await readJson(await fetch(`${API}/operators/routes`)); }catch(_){ state.routes = []; }
  }
  return state.routes;
}
async function loadDrivers(force){
  if(force || !state.drivers) state.drivers = await api(`/fleet/companies/${state.companyId}/drivers`);
  return state.drivers;
}

/* ---------- start: email links land here, and the token leaves the address bar at once ---------- */
async function start(){
  const params = new URLSearchParams(location.search);
  const verify = params.get('verify');
  const reset = params.get('reset');
  if(verify || reset) history.replaceState(null, '', location.pathname + location.hash);
  if(verify){
    state.login = { ...freshLogin(), step: 'working', notice: 'Confirming your email…' };
    showAuth();
    try{ await finishSignIn(await publicPost('/auth/email/verify', { token: verify })); }
    catch(err){ authGo('linkFailed', { error: err.message }); }
    return;
  }
  if(reset){ state.login = { ...freshLogin(), step: 'reset', resetToken: reset }; showAuth(); return; }
  loadAuth();
  if(state.auth?.refreshToken) await bootApp(); else showAuth();
}
window.addEventListener('DOMContentLoaded', start);
