const API = window.BATO_CONFIG?.api || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
const $ = (s) => document.querySelector(s);
const esc = (s='') => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';

const state = {
  auth: null,
  screen: 'articles',
  error: '',
  login: { step: 'email', email: '', phone: '', devCode: '', challengeToken: '', enrol: null, error: '', busy: false },
  articles: { items: [], meta: null, status: '', q: '', editing: null, saving: false },
  categories: [], issues: [], routes: [], destinations: [],
  elevate: { items: [] },
  moderation: { tab: 'reports', posts: [], comments: [], reviews: [], reports: [], busReviews: [], queue: null, badge: 0 },
  fleet: { stats: null, items: [], status: '', q: '' },
  users: { items: [], q: '', role: '', suspendedOnly: false },
  overview: null, subscriptions: [], auditLog: [],
  ads: { items: [], status: '', surface: '', editing: null, confirmDelete: null, flash: '' },
  guides: { items: [], status: '', routeId: '', kind: '', editing: null, stopsFor: null, editingStop: null, flash: '' },
  creators: { items: [], status: '' },
};

/* =========================== API =========================== */

function tokenExpiresSoon(token){
  try{
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 - Date.now() < 30_000;
  }catch(_){
    return true;
  }
}

let refreshing = null;
/**
 * One refresh at a time across tabs: the server ends the whole session when a
 * refresh token is presented twice, which two tabs refreshing together would do.
 */
function refreshSession(){
  if(refreshing) return refreshing;
  const run = async () => {
    const stored = JSON.parse(localStorage.getItem('bato.admin.auth') || 'null');
    if(!stored?.refreshToken){ const e = new Error('signed out'); e.expired = true; throw e; }
    if(stored.accessToken !== state.auth?.accessToken && !tokenExpiresSoon(stored.accessToken)){
      state.auth = stored;
      return stored;
    }
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    if(!res.ok){ const e = new Error('Could not refresh the session'); e.expired = res.status === 401; throw e; }
    const { data } = await res.json();
    state.auth = { ...stored, accessToken: data.accessToken, refreshToken: data.refreshToken };
    localStorage.setItem('bato.admin.auth', JSON.stringify(state.auth));
    return state.auth;
  };
  refreshing = (navigator.locks ? navigator.locks.request('bato-admin-refresh', run) : run())
    .finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * fetch with the admin session. A 401 only means "session ended" when there is
 * a session; on the sign-in screen it is a wrong password and must reach the form.
 */
async function authedFetch(url, opts = {}){
  if(!state.auth) return fetch(url, opts);
  const ended = () => { signOut('Your session ended. Sign in again.'); return new Error('Session ended'); };

  if(tokenExpiresSoon(state.auth.accessToken)){
    try{ await refreshSession(); }catch(err){ if(err.expired) throw ended(); }
  }
  const call = () => fetch(url, {
    ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${state.auth.accessToken}` },
  });
  let res = await call();
  if(res.status === 401){
    try{ await refreshSession(); }catch(err){ if(err.expired) throw ended(); throw err; }
    res = await call();
    if(res.status === 401) throw ended();
  }
  return res;
}

/** Saves a file the API makes under the name the server gives it. */
async function downloadFile(path){
  const res = await authedFetch(`${API}${path}`);
  if(!res.ok){
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.message || 'That file could not be made. Try again.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'batoma-download';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function api(path, opts = {}){
  const res = await authedFetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(json?.message || json?.error?.message || 'Something went wrong');
  return json.data;
}

function loadAuth(){
  try{ state.auth = JSON.parse(localStorage.getItem('bato.admin.auth') || 'null'); }
  catch(_){ state.auth = null; }
}
function saveAuth(data){
  state.auth = { accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user };
  localStorage.setItem('bato.admin.auth', JSON.stringify(state.auth));
}
function freshLoginState(){
  return { step: 'email', email: '', phone: '', devCode: '', challengeToken: '', enrol: null, error: '', busy: false };
}

function signOut(message){
  const auth = state.auth;
  state.auth = null;
  state.login = freshLoginState();
  localStorage.removeItem('bato.admin.auth');
  renderRoot();
  if(message) setLoginError(message);
  if(auth?.refreshToken){
    fetch(`${API}/auth/logout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    }).catch(()=>{});
  }
}
function setLoginError(msg){ state.login.error = msg; renderLogin(); }

/* =========================== login =========================== */

const loginTabs = (active) => `
  <div class="login-tabs" role="tablist" aria-label="Sign-in method">
    <button role="tab" type="button" aria-selected="${active==='email'}" data-action="switchLogin" data-mode="email">Email</button>
    <button role="tab" type="button" aria-selected="${active==='phone'}" data-action="switchLogin" data-mode="phone">Phone</button>
  </div>`;

function switchLogin(step){ state.login = { ...freshLoginState(), step }; renderLogin(); }

const LOGIN_VIEWS = {
  email(){
    const l = state.login;
    return `
      <h1>Batoma control panel</h1>
      <p class="sub">Editors, moderators and admins sign in, then confirm with an authenticator app.</p>
      ${loginTabs('email')}
      <form data-submit="loginSubmitEmail">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="username" value="${esc(l.email)}" autofocus required>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required>
        ${l.error ? `<div class="error" role="alert">${esc(l.error)}</div>` : ''}
        <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Signing in…':'Continue'}</button>
      </form>
      <a class="back" href="login.html" style="margin-top:16px">Forgot your password? Reset it on the sign-in page →</a>`;
  },
  phone(){
    const l = state.login;
    return `
      <h1>Batoma control panel</h1>
      <p class="sub">Editors, moderators and admins sign in with their phone, then an authenticator app.</p>
      ${loginTabs('phone')}
      <form data-submit="loginSubmitPhone">
        <label for="phone">Phone number</label>
        <input id="phone" type="tel" inputmode="numeric" placeholder="98XXXXXXXX" value="${esc(l.phone)}" autofocus required>
        ${l.error ? `<div class="error">${esc(l.error)}</div>` : ''}
        <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Sending…':'Send code'}</button>
      </form>
      <a class="back" href="login.html" style="margin-top:16px">Travelling and want to vlog instead? Sign in here →</a>`;
  },
  code(){
    const l = state.login;
    return `
      <h1>Enter the code</h1>
      <p class="sub">Sent to ${esc(l.phone)}.</p>
      ${l.devCode ? `<div class="card" style="margin-bottom:14px">No SMS gateway configured — code:
        <div class="devcode">${esc(l.devCode)}</div></div>` : ''}
      <form data-submit="loginSubmitCode">
        <label for="code">6-digit code</label>
        <input id="code" inputmode="numeric" maxlength="6" placeholder="123456" autofocus required>
        ${l.error ? `<div class="error">${esc(l.error)}</div>` : ''}
        <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Checking…':'Continue'}</button>
      </form>
      <button class="btn btn-ghost" style="margin-top:8px" data-action="loginRestartPhone">Use a different number</button>`;
  },
  mfa(){
    const l = state.login;
    return `
      <h1>Authenticator code</h1>
      <p class="sub">Enter the 6-digit code from Google Authenticator or Authy.</p>
      <form data-submit="loginSubmitMfa">
        <label for="mfacode">Code</label>
        <input id="mfacode" inputmode="numeric" maxlength="6" placeholder="123456" autofocus required>
        ${l.error ? `<div class="error">${esc(l.error)}</div>` : ''}
        <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Checking…':'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" style="margin-top:8px" data-action="loginStep" data-step="recover">Lost your phone? Use a recovery code</button>`;
  },
  recover(){
    const l = state.login;
    return `
      <h1>Use a recovery code</h1>
      <p class="sub">Enter one of the ten codes you saved when you set up your authenticator. Each works once.</p>
      <form data-submit="loginSubmitRecover">
        <label for="rcode">Recovery code</label>
        <input id="rcode" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="k7m2p-xq4hz" maxlength="20" autofocus required>
        ${l.error ? `<div class="error">${esc(l.error)}</div>` : ''}
        <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Checking…':'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" style="margin-top:8px" data-action="loginStep" data-step="mfa">Use the authenticator instead</button>`;
  },
  codes(){
    const l = state.login;
    return `
      <h1>Save your recovery codes</h1>
      <p class="sub">If you lose your phone, each code lets you sign in once. Keep them somewhere safe and private, not on the phone
        with the authenticator. They are shown only now.</p>
      <ol class="codes">${l.codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
      <button class="btn btn-ghost" data-action="downloadRecoveryCodes">Save as a text file</button>
      <button class="btn btn-primary" style="margin-top:8px" data-action="recoveryCodesSaved">I have saved them</button>`;
  },
  enrol(){
    const l = state.login;
    return `
      <h1>Set up your authenticator</h1>
      <p class="sub">This account has elevated permissions and needs a second factor before it can be used.</p>
      ${l.enrol ? `
        <div class="card" style="margin-bottom:14px">
          <p style="margin:0 0 8px">Scan in Google Authenticator or Authy, or add this key manually:</p>
          <div class="secret">${esc(l.enrol.secret)}</div>
        </div>
        <form data-submit="loginSubmitEnrolConfirm">
          <label for="enrolcode">6-digit code from the app</label>
          <input id="enrolcode" inputmode="numeric" maxlength="6" placeholder="123456" autofocus required>
          ${l.error ? `<div class="error">${esc(l.error)}</div>` : ''}
          <button class="btn btn-primary" type="submit" ${l.busy?'disabled':''}>${l.busy?'Confirming…':'Confirm and sign in'}</button>
        </form>` : `<p class="sub">Preparing enrolment…</p>`}`;
  },
};

function renderLogin(){
  $('#login-view').innerHTML = LOGIN_VIEWS[state.login.step]();
}

async function loginSubmitPhone(e){
  e.preventDefault();
  const l = state.login;
  l.phone = $('#phone').value.trim(); l.error = ''; l.busy = true; renderLogin();
  try{
    const data = await api('/auth/otp/request', { method: 'POST', body: { phone: l.phone } });
    l.devCode = data.devCode || '';
    /**
     * devCode only exists in the response when no SMS gateway is configured,
     * which env.validation.ts refuses to allow in production — so this path
     * is a no-op in a real deployment and only skips typing in local dev/testing.
     */
    if(l.devCode){
      await completeOtpVerify(l.devCode);
      return;
    }
    l.busy = false; l.step = 'code'; renderLogin();
  }catch(err){ l.busy = false; l.error = err.message; renderLogin(); }
}

async function loginSubmitCode(e){
  e.preventDefault();
  await completeOtpVerify($('#code').value.trim());
}

async function completeOtpVerify(code){
  const l = state.login;
  l.error = ''; l.busy = true; l.step = 'code'; renderLogin();
  try{
    await handleSignInResult(await api('/auth/otp/verify', { method: 'POST', body: { phone: l.phone, code } }));
  }catch(err){ l.busy = false; l.step = 'code'; l.error = err.message; renderLogin(); }
}

async function loginSubmitEmail(e){
  e.preventDefault();
  const l = state.login;
  l.email = $('#email').value.trim();
  const password = $('#password').value;
  l.error = ''; l.busy = true; renderLogin();
  try{
    await handleSignInResult(await api('/auth/email/login', { method: 'POST', body: { email: l.email, password } }));
  }catch(err){ l.busy = false; l.step = 'email'; l.error = err.message; renderLogin(); }
}

/** Same branching for every sign-in method: session, authenticator code, or first-time enrolment. */
async function handleSignInResult(data){
  const l = state.login;
  if(data.mfaEnrolmentRequired){
    l.challengeToken = data.challengeToken; l.busy = false; l.step = 'enrol'; renderLogin();
    l.enrol = await api('/auth/mfa/enrol/start', { method: 'POST', body: { challengeToken: l.challengeToken } });
    renderLogin();
    return;
  }
  if(data.mfaRequired){
    l.challengeToken = data.challengeToken; l.busy = false; l.step = 'mfa'; renderLogin();
    return;
  }
  onSignedIn(data);
}

async function loginSubmitMfa(e){
  e.preventDefault();
  const l = state.login;
  const code = $('#mfacode').value.trim();
  l.error = ''; l.busy = true; renderLogin();
  try{
    const data = await api('/auth/mfa/verify', { method: 'POST', body: { challengeToken: l.challengeToken, code } });
    onSignedIn(data);
  }catch(err){ l.busy = false; l.error = err.message; renderLogin(); }
}

async function loginSubmitEnrolConfirm(e){
  e.preventDefault();
  const l = state.login;
  const code = $('#enrolcode').value.trim();
  l.error = ''; l.busy = true; renderLogin();
  try{
    const data = await api('/auth/mfa/enrol/confirm', { method: 'POST', body: { challengeToken: l.challengeToken, code } });
    // The codes come once, before the panel opens.
    if(data.recoveryCodes?.length){ Object.assign(l, { busy: false, step: 'codes', codes: data.recoveryCodes, pending: data }); renderLogin(); return; }
    onSignedIn(data);
  }catch(err){ l.busy = false; l.error = err.message; renderLogin(); }
}

async function loginSubmitRecover(e){
  e.preventDefault();
  const l = state.login;
  const code = $('#rcode').value.trim();
  l.error = ''; l.busy = true; renderLogin();
  try{
    const data = await api('/auth/mfa/recover', { method: 'POST', body: { challengeToken: l.challengeToken, code } });
    onSignedIn(data);
    notify(`Signed in with a recovery code. ${data.recoveryCodesLeft} left${data.recoveryCodesLeft <= 2 ? ': ask another admin to reset your authenticator.' : '.'}`, data.recoveryCodesLeft <= 2 ? 'error' : 'ok');
  }catch(err){ l.busy = false; l.error = err.message; renderLogin(); }
}

function downloadRecoveryCodes(){
  const l = state.login;
  const text = `Batoma control panel recovery codes for ${l.email || 'your account'}\nEach works once. Made ${new Date().toISOString().slice(0, 10)}.\n\n${l.codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'batoma-recovery-codes.txt' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Fresh recovery codes for a staff account; the old ones stop working. */
async function newRecoveryCodes(){
  const code = await askDialog({
    title: 'New recovery codes', confirmLabel: 'Make new codes',
    message: 'New codes replace the old ones, which stop working. Enter the current code from your authenticator app.',
    field: { label: '6-digit code', placeholder: '123456', validate: (v) => (/^\d{6}$/.test(v) ? '' : 'Enter the 6 digits from the app.') },
  });
  if(!code) return;
  let codes;
  try{ codes = (await api('/auth/mfa/recovery-codes', { method: 'POST', body: { code } })).recoveryCodes; }
  catch(err){ notify(err.message, 'error'); return; }
  state.login.codes = codes;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="codes-title">
    <h2 id="codes-title">Your new recovery codes</h2>
    <p class="hint">Each lets you sign in once if you lose your phone. Keep them somewhere safe and private. They are shown only now.</p>
    <ol class="codes">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ol>
    <div class="row-actions"><button class="btn" data-action="downloadRecoveryCodes">Save as a text file</button>
      <button class="btn btn-primary" data-close>I have saved them</button></div></div>`;
  back.addEventListener('click', (e) => { if(e.target.closest('[data-close]')){ back.remove(); state.login.codes = null; } });
  document.body.appendChild(back);
}

async function signOutEverywhere(){
  const ok = await askDialog({ title: 'Sign out everywhere?', confirmLabel: 'Sign out everywhere', danger: true,
    message: 'Every device signed in to this account is signed out at once, this one too.' });
  if(!ok) return;
  try{ await api('/auth/logout-all', { method: 'POST' }); }catch(_){ /* signed out below either way */ }
  signOut('Signed out on every device.');
}

function onSignedIn(data){
  const role = data.user?.role;
  if(!['EDITOR','MODERATOR','ADMIN'].includes(role)){
    state.login = freshLoginState();
    state.login.error = 'This account does not have editorial or admin access.';
    renderLogin();
    return;
  }
  saveAuth(data);
  state.login = freshLoginState();
  state.screen = defaultScreen(role);
  renderRoot();
}

/* =========================== dialogs & notices =========================== */

/**
 * In-page replacement for prompt(), confirm() and alert(): styled, keyboard
 * accessible, and reachable by assistive technology. Resolves to the entered
 * value (or true when there is no field), or null when cancelled.
 */
function askDialog({ title, message = '', confirmLabel = 'Confirm', danger = false, field = null }){
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back dialog-back';
    const control = !field ? ''
      : field.type === 'select'
        ? `<select id="dlg-field" aria-label="${esc(field.label)}">${field.options.map(([value, text]) =>
            `<option value="${esc(value)}" ${value === field.value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`
        : field.type === 'textarea'
          ? `<textarea id="dlg-field" aria-label="${esc(field.label)}" maxlength="1000" style="min-height:90px;font-family:inherit"
               placeholder="${esc(field.placeholder || '')}"></textarea>`
          : `<input id="dlg-field" aria-label="${esc(field.label)}" type="${field.type || 'text'}" autocomplete="off"
               ${field.min != null ? `min="${field.min}"` : ''} ${field.max != null ? `max="${field.max}"` : ''}
               placeholder="${esc(field.placeholder || '')}" value="${esc(field.value ?? '')}">`;
    back.innerHTML = `
      <form class="modal dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title"
            ${message ? 'aria-describedby="dlg-msg"' : ''} novalidate>
        <h2 id="dlg-title">${esc(title)}</h2>
        ${message ? `<p id="dlg-msg" class="dialog-msg">${esc(message)}</p>` : ''}
        ${field ? `<label for="dlg-field">${esc(field.label)}</label>${control}` : ''}
        <div id="dlg-error" class="error" role="alert" hidden></div>
        <div class="row-actions" style="margin-top:18px">
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(confirmLabel)}</button>
          <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        </div>
      </form>`;

    const returnFocus = document.activeElement;
    const close = (value) => { back.remove(); returnFocus?.focus?.(); resolve(value); };
    back.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if(!field) return close(true);
      const input = back.querySelector('#dlg-field');
      const value = input.value.trim();
      const problem = field.validate ? field.validate(value) : '';
      if(problem){
        const box = back.querySelector('#dlg-error');
        box.textContent = problem;
        box.hidden = false;
        input.focus();
        return;
      }
      close(value);
    });
    back.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    back.addEventListener('click', (e) => { if(e.target === back) close(null); });
    back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(null); });
    document.body.appendChild(back);
    (back.querySelector('#dlg-field') || back.querySelector('button[type="submit"]')).focus();
  });
}

let noticeTimer = null;
/** A short status message in the corner, announced to screen readers. */
function notify(message, kind = 'ok'){
  let box = document.getElementById('notice');
  if(!box){
    box = document.createElement('div');
    box.id = 'notice';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  box.className = `notice ${kind}`;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6000 : 3500);
}

/* =========================== shell =========================== */

const SECTIONS = [
  ['overview', 'Overview', ['ADMIN']],
  ['fleet', 'Bus companies', ['ADMIN']],
  ['ads', 'Ads', ['ADMIN']],
  ['articles', 'Articles', ['EDITOR', 'ADMIN']],
  ['issues', 'Issues', ['EDITOR', 'ADMIN']],
  ['guides', 'Route guides', ['EDITOR', 'ADMIN']],
  ['programming', 'Route programming', ['EDITOR', 'MODERATOR', 'ADMIN']],
  ['creators', 'Creators', ['EDITOR', 'ADMIN']],
  ['moderation', 'Moderation', ['MODERATOR', 'ADMIN']],
  ['users', 'Users', ['MODERATOR', 'ADMIN']],
];

/** Where each role starts: a moderator cannot load articles, so must never land on them. */
function defaultScreen(role){
  return role === 'ADMIN' ? 'overview' : role === 'EDITOR' ? 'articles' : 'moderation';
}

function visibleSections(){
  const role = state.auth?.user?.role;
  return SECTIONS.filter(([, , roles]) => roles.includes(role));
}

function renderSidebar(){
  const role = state.auth?.user?.role;
  $('#sidebar').innerHTML = `
    <h1>Batoma</h1>
    <div class="who">${esc(state.auth?.user?.name || '')} · ${esc(role || '')}</div>
    <nav>
      ${visibleSections().map(([key, label]) => {
        const badge = key === 'moderation' && state.moderation.badge
          ? `<span class="nav-badge" aria-label="${state.moderation.badge} waiting">${state.moderation.badge}</span>` : '';
        return `<button class="${state.screen===key?'active':''}" data-action="goSection" data-key="${key}">${label}${badge}</button>`;
      }).join('')}
    </nav>
    <div class="signout">
      <button class="btn btn-ghost btn-sm" data-action="openPalettePicker">🎨 Appearance</button>
      <button class="btn btn-ghost btn-sm" data-action="signOut">Sign out</button>
      <button class="btn btn-ghost btn-sm" data-action="newRecoveryCodes">New recovery codes</button>
      <button class="btn btn-ghost btn-sm" data-action="signOutEverywhere">Sign out everywhere</button>
    </div>`;
}

function goSection(key){ state.screen = key; renderMain(); renderSidebar(); }

function renderRoot(){
  if(state.auth){
    $('#login-view').style.display = 'none';
    $('#shell').classList.add('on');
    renderSidebar();
    renderMain();
    refreshModerationBadge();
  } else {
    $('#shell').classList.remove('on');
    $('#login-view').style.display = 'block';
    renderLogin();
  }
}

async function renderMain(){
  const html = await (SCREENS[state.screen] || SCREENS.articles)();
  $('#main').innerHTML = html;
  if((state.screen === 'ads' || state.screen === 'website') && state.ads.editing){ toggleAdLink(); updateAdPreview(); }
  if(state.screen === 'guides' && state.guides.editing) toggleGuideKind();
}

/* =========================== articles =========================== */

async function loadArticles(){
  const params = new URLSearchParams({ limit: '50' });
  if(state.articles.status) params.set('status', state.articles.status);
  if(state.articles.q) params.set('q', state.articles.q);
  const data = await api(`/magazine/admin/articles?${params}`);
  state.articles.items = data.items; state.articles.meta = data.meta;
}
async function loadReferenceData(){
  if(!state.categories.length) state.categories = await api('/magazine/categories');
  if(!state.issues.length) state.issues = (await api('/magazine/admin/issues')) || [];
  if(!state.routes.length) state.routes = (await api('/operators/routes')) || [];
  if(!state.destinations.length) state.destinations = (await api('/places/destinations')) || [];
}

function articleForm(a){
  const isNew = !a || !a.id;
  return `
    <div class="modal-back" data-action="backdrop" data-closer="closeArticleForm">
      <div class="modal">
        <h2 style="margin-bottom:14px">${isNew ? 'New article' : 'Edit article'}</h2>
        <form data-submit="saveArticle" data-id="${isNew ? '' : a.id}">
          <label for="af-title">Title</label>
          <input id="af-title" value="${esc(a?.title)}" required minlength="3">
          <label for="af-subtitle">Subtitle</label>
          <input id="af-subtitle" value="${esc(a?.subtitle)}">
          <label for="af-summary">Summary <span class="hint">one line for story cards; needed to publish</span></label>
          <input id="af-summary" maxlength="160" value="${esc(a?.summary)}" data-input="countSummary" aria-describedby="af-summary-count">
          <div id="af-summary-count" class="hint counter" aria-live="polite">${(a?.summary || '').length} / 160</div>
          <fieldset class="key-points">
            <legend>In brief: key points <span class="hint">one to three short lines; needed to publish</span></legend>
            ${[0, 1, 2].map((i) => `<input id="af-point-${i}" maxlength="160" aria-label="Key point ${i + 1}" placeholder="Key point ${i + 1}" value="${esc(a?.keyPoints?.[i] || '')}">`).join('')}
          </fieldset>
          <label>Cover image</label>
          <div class="cover-field">
            <div id="af-cover-preview" class="cover-preview">
              ${a?.coverImageUrl ? `<img src="${esc(a.coverImageUrl)}" alt="Cover preview">` : '<span>No cover yet</span>'}
            </div>
            <div>
              <input id="af-cover" type="hidden" value="${esc(a?.coverImageUrl)}">
              <div class="row-actions">
                <button class="btn btn-sm" type="button" data-action="pickFile" data-target="af-cover-file">Upload image</button>
                <button class="btn btn-sm btn-ghost" type="button" data-action="clearCover">Remove</button>
              </div>
              <div id="af-cover-status" class="hint" aria-live="polite">JPG, PNG, WebP or AVIF, up to 8 MB</div>
              <input id="af-cover-file" class="sr-only" type="file" accept="image/*" tabindex="-1"
                     aria-label="Choose cover image" data-change="uploadCover">
            </div>
          </div>
          <div class="two-col">
            <div>
              <label for="af-category">Category</label>
              <select id="af-category">
                <option value="">—</option>
                ${state.categories.map(c => `<option value="${c.id}" ${a?.category?.id===c.id||a?.categoryId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="af-issue">Issue</label>
              <select id="af-issue">
                <option value="">—</option>
                ${state.issues.map(i => `<option value="${i.id}" ${a?.issue?.id===i.id||a?.issueId===i.id?'selected':''}>#${i.number} ${esc(i.title)}</option>`).join('')}
              </select>
            </div>
          </div>
          <label for="af-body">Body (markdown)</label>
          <textarea id="af-body" required minlength="20">${esc(a?.body)}</textarea>
          <div class="checks">
            <label><input id="af-featured" type="checkbox" ${a?.isFeatured?'checked':''}> Featured</label>
            <label><input id="af-sponsored" type="checkbox" ${a?.isSponsored?'checked':''}> Sponsored</label>
            <label><input id="af-website" type="checkbox" ${a?.onWebsite === false ? '' : 'checked'}> On the public website</label>
          </div>
          <div class="hint">Untick to keep it in the app only. Drafts are never on the website until published.</div>
          ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
          <div class="row-actions" style="margin-top:18px">
            <button class="btn btn-primary" type="submit" ${state.articles.saving?'disabled':''}>
              ${state.articles.saving ? 'Saving…' : (isNew ? 'Create draft' : 'Save changes')}
            </button>
            <button class="btn btn-ghost" type="button" data-action="closeArticleForm">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
}

function openArticleForm(article){
  state.articles.editing = article || {};
  state.error = '';
  renderMain();
}
function closeArticleForm(){ state.articles.editing = null; renderMain(); }

/* =========================== image upload =========================== */

/** Resize and re-encode (which also strips EXIF location data) before upload. */
async function prepareImage(file, maxDim = 2000){
  let bitmap;
  try{ bitmap = await createImageBitmap(file); }catch(_){ return file; }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
}

async function uploadImages(files){
  const form = new FormData();
  for(const f of files) form.append('files', await prepareImage(f));
  const res = await authedFetch(`${API}/media/upload`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(json?.message || 'Upload failed. Please try again.');
  return json.data;
}

function setCover(url){
  $('#af-cover').value = url;
  $('#af-cover-preview').innerHTML = url
    ? `<img src="${esc(url)}" alt="Cover preview">`
    : '<span>No cover yet</span>';
}

async function uploadCover(files){
  if(!files.length) return;
  const status = $('#af-cover-status');
  status.textContent = 'Uploading…';
  try{
    const { files: saved } = await uploadImages(files.slice(0, 1));
    setCover(saved[0].url);
    status.textContent = 'Uploaded. Save the article to keep it.';
  }catch(err){
    status.textContent = err.message;
  }
}

async function saveArticle(e, id){
  e.preventDefault();
  const dto = {
    title: $('#af-title').value.trim(),
    subtitle: $('#af-subtitle').value.trim() || undefined,
    summary: $('#af-summary').value.trim(),
    keyPoints: [0, 1, 2].map((i) => $(`#af-point-${i}`).value.trim()).filter(Boolean),
    coverImageUrl: $('#af-cover').value || null,
    categoryId: $('#af-category').value || undefined,
    issueId: $('#af-issue').value || undefined,
    body: $('#af-body').value,
    isFeatured: $('#af-featured').checked,
    isSponsored: $('#af-sponsored').checked,
    onWebsite: $('#af-website').checked,
  };
  state.articles.saving = true; state.error = ''; renderMain();
  try{
    if(id) await api(`/magazine/articles/${id}`, { method: 'PATCH', body: dto });
    else await api('/magazine/articles', { method: 'POST', body: dto });
    state.articles.saving = false; state.articles.editing = null;
    await loadArticles(); renderMain();
  }catch(err){
    state.articles.saving = false; state.error = err.message; renderMain();
  }
}

async function publishArticle(id){
  await api(`/magazine/articles/${id}/publish`, { method: 'PATCH' });
  await loadArticles(); renderMain();
}
async function archiveArticle(id){
  await api(`/magazine/articles/${id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } });
  await loadArticles(); renderMain();
}
async function deleteArticleForever(id){
  const title = state.articles.items.find((x) => x.id === id)?.title || 'this article';
  const typed = await askDialog({
    title: 'Delete this article permanently?',
    message: `“${title}” is removed for good, with its route and destination links. This can’t be undone; archiving hides it instead and can be reversed.`,
    confirmLabel: 'Delete permanently',
    danger: true,
    field: {
      label: 'Type DELETE to confirm', placeholder: 'DELETE',
      validate: (v) => (v === 'DELETE' ? '' : 'Type DELETE in capital letters to confirm.'),
    },
  });
  if(typed === null) return;
  try{
    await api(`/magazine/articles/${id}`, { method: 'DELETE' });
    notify('Article deleted.');
  }catch(err){
    notify(err.message, 'error');
  }
  await loadArticles(); renderMain();
}
function filterArticles(patch){ Object.assign(state.articles, patch); loadArticles().then(renderMain); }

async function screenArticles(){
  await Promise.all([loadArticles(), loadReferenceData()]);
  const a = state.articles;
  const role = state.auth?.user?.role;
  return `
    <div class="top-row">
      <h2>Articles</h2>
      <button class="btn btn-primary" data-action="openArticleForm">+ New article</button>
    </div>
    <div class="filters">
      <input placeholder="Search title or subtitle…" value="${esc(a.q)}"
             data-change="filterArticles" data-field="q">
      <select data-change="filterArticles" data-field="status">
        ${['', 'DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'].map(s =>
          `<option value="${s}" ${a.status===s?'selected':''}>${s || 'All statuses'}</option>`).join('')}
      </select>
    </div>
    ${a.items.length === 0 ? '<div class="empty">No articles match.</div>' : `
      <table><thead><tr><th>Title</th><th>Status</th><th>Category</th><th>Updated</th><th></th></tr></thead>
      <tbody>
        ${a.items.map(x => `
          <tr>
            <td>${esc(x.title)}</td>
            <td><span class="pill ${x.status}">${x.status}</span>${x.status === 'PUBLISHED' && x.onWebsite === false ? '<div class="hint">App only, not on the website</div>' : ''}</td>
            <td>${esc(x.category?.name || '—')}</td>
            <td>${fmtDate(x.updatedAt)}</td>
            <td class="row-actions">
              <button class="btn btn-sm" data-action="editArticle" data-id="${x.id}">Edit</button>
              ${x.status !== 'PUBLISHED' ? `<button class="btn btn-sm btn-brand" data-action="publishArticle" data-id="${x.id}">Publish</button>` : ''}
              ${x.status !== 'ARCHIVED' ? `<button class="btn btn-sm" data-action="archiveArticle" data-id="${x.id}">Archive</button>` : ''}
              ${role === 'ADMIN' ? `<button class="btn btn-sm btn-danger" data-action="deleteArticleForever" data-id="${x.id}">Delete forever</button>` : ''}
            </td>
          </tr>`).join('')}
      </tbody></table>`}
    ${await screenElevate()}
    ${a.editing ? articleForm(a.editing.id ? a.editing : null) : ''}`;
}

async function editArticle(id){
  const full = await api(`/magazine/admin/articles/${id}`);
  state.articles.editing = full;
  renderMain();
}

async function screenElevate(){
  const posts = await api('/posts?limit=50');
  const candidates = (posts.items || []).filter((p) => !p.isElevated);
  if(!candidates.length) return '';
  return `
    <div class="top-row" style="margin-top:30px"><h3>Approved traveller posts not yet in the magazine</h3></div>
    <table><thead><tr><th>Title</th><th>Author</th><th>Published</th><th></th></tr></thead>
    <tbody>
      ${candidates.map(p => `
        <tr>
          <td>${esc(p.title)}</td>
          <td>${esc(p.author?.name || '—')}</td>
          <td>${fmtDate(p.publishedAt)}</td>
          <td><button class="btn btn-sm btn-brand" data-action="elevatePost" data-id="${p.id}">Elevate to magazine</button></td>
        </tr>`).join('')}
    </tbody></table>`;
}

async function elevatePost(postId){
  try{
    await api('/magazine/elevate', { method: 'POST', body: { postId } });
    notify('Added to the magazine with the traveller’s byline.');
    await loadArticles(); renderMain();
  }catch(err){
    notify(err.message, 'error');
  }
}

/* =========================== issues =========================== */

async function screenIssues(){
  await loadReferenceData();
  return `
    <div class="top-row"><h2>Issues</h2></div>
    <form class="card" style="margin-bottom:20px;max-width:480px" data-submit="createIssue">
      <label for="iss-num">Issue number</label>
      <input id="iss-num" type="number" min="1" required>
      <label for="iss-title">Title</label>
      <input id="iss-title" required minlength="3">
      <label for="iss-strapline">Strapline</label>
      <input id="iss-strapline">
      <button class="btn btn-primary" style="margin-top:14px" type="submit">Create issue</button>
    </form>
    ${state.issues.length === 0 ? '<div class="empty">No issues yet.</div>' : `
      <table><thead><tr><th>#</th><th>Title</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${state.issues.map(i => `
          <tr>
            <td>${i.number}</td><td>${esc(i.title)}</td>
            <td><span class="pill ${i.status || 'PUBLISHED'}">${i.status || 'PUBLISHED'}</span></td>
            <td>${!i.publishedAt ? `<button class="btn btn-sm btn-brand" data-action="publishIssue" data-id="${i.id}">Publish</button>` : ''}</td>
          </tr>`).join('')}
      </tbody></table>`}`;
}

async function createIssue(e){
  e.preventDefault();
  const dto = {
    number: Number($('#iss-num').value), title: $('#iss-title').value.trim(),
    strapline: $('#iss-strapline').value.trim() || undefined,
  };
  try{
    await api('/magazine/issues', { method: 'POST', body: dto });
    notify(`Issue ${dto.number} created.`);
    state.issues = []; await loadReferenceData(); renderMain();
  }catch(err){
    notify(err.message, 'error');
  }
}
async function publishIssue(id){
  await api(`/magazine/issues/${id}/publish`, { method: 'PATCH' });
  state.issues = []; await loadReferenceData(); renderMain();
}

/* =========================== moderation =========================== */

const REASON_LABEL = {
  SPAM: 'Spam', HARASSMENT: 'Harassment', MISINFORMATION: 'Misinformation', ILLEGAL: 'Illegal or dangerous',
  SEXUAL_CONTENT: 'Sexual content', COPYRIGHT: 'Copyright', UNSAFE_BUSINESS: 'Unsafe business',
  WRONG_CREW: 'Wrong crew named', OTHER: 'Other',
};

const queueTotal = (q) => q.reportedItems + q.pendingPosts + q.pendingComments + q.pendingReviews + (q.pendingBusReviews || 0);

async function loadModeration(){
  const m = state.moderation;
  const [queue, posts, comments, reviews, reports, busReviews] = await Promise.all([
    api('/moderation/queue'),
    api('/moderation/posts'), api('/moderation/comments'),
    api('/moderation/reviews'), api('/moderation/reports'), api('/moderation/bus-reviews'),
  ]);
  m.queue = queue; m.posts = posts; m.comments = comments; m.reviews = reviews; m.reports = reports; m.busReviews = busReviews;
  m.badge = queueTotal(queue);
}

/** Keeps the Moderation badge current from any screen. */
async function refreshModerationBadge(){
  if(!['MODERATOR', 'ADMIN'].includes(state.auth?.user?.role)) return;
  try{
    state.moderation.badge = queueTotal(await api('/moderation/queue'));
    renderSidebar();
  }catch(_){}
}

function removeLabel(type){
  return {
    POST: 'Remove vlog', COMMENT: 'Remove comment', REVIEW: 'Reject review', BUS_REVIEW: 'Remove bus review',
    ARTICLE: 'Archive article', BUSINESS: 'Switch off listing', USER: 'Suspend account',
  }[type] || 'Remove';
}

function modTable(items, targetType, columns){
  if(!items.length) return '<div class="empty">Nothing waiting for review.</div>';
  return `
    <div class="table-wrap"><table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>
      ${items.map(x => `
        <tr>
          ${columns.map(c => `<td>${esc(c.render(x))}</td>`).join('')}
          <td class="row-actions">
            <button class="btn btn-sm btn-brand" data-action="moderate" data-type="${targetType}" data-id="${x.id}" data-act="APPROVE">Approve</button>
            <button class="btn btn-sm" data-action="moderate" data-type="${targetType}" data-id="${x.id}" data-act="REJECT">Reject</button>
            <button class="btn btn-sm btn-danger" data-action="moderate" data-type="${targetType}" data-id="${x.id}" data-act="DELETE">Delete</button>
          </td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

/** Only irreversible removal asks for confirmation; keeping, rejecting and hiding act straight away. */
async function confirmRemoval(targetType, what){
  return askDialog({
    title: `${removeLabel(targetType)}?`,
    message: ['POST', 'COMMENT', 'BUS_REVIEW'].includes(targetType)
      ? `${what} is deleted for good. The author can’t restore it, and every open report on it is closed.`
      : `${what} stops being visible to readers, and every open report on it is closed.`,
    confirmLabel: removeLabel(targetType),
    danger: true,
    field: { type: 'textarea', label: 'Note for the audit log (optional)', placeholder: 'e.g. Harassment of another traveller' },
  });
}

async function moderate(targetType, targetId, action){
  let note;
  if(action === 'DELETE'){
    note = await confirmRemoval(targetType, 'This item');
    if(note === null) return;
  }
  try{
    await api('/moderation/act', { method: 'POST', body: { targetType, targetId, action, note: note || undefined } });
    notify(action === 'APPROVE' ? 'Approved.' : action === 'REJECT' ? 'Rejected.' : 'Removed.');
  }catch(err){
    notify(err.message, 'error');
  }
  renderMain();
}

async function decideReport(key, action){
  const [targetType, targetId] = key.split(':');
  const group = state.moderation.reports.find((g) => g.targetType === targetType && g.targetId === targetId);
  const preview = group?.preview;
  let note;
  if(action === 'DELETE'){
    const what = preview?.title ? `“${preview.title}”` : `This ${(preview?.kind || 'item').toLowerCase()}`;
    note = await confirmRemoval(targetType, what);
    if(note === null) return;
  }
  try{
    await api('/moderation/act', { method: 'POST', body: { targetType, targetId, action, note: note || undefined } });
    notify(action === 'APPROVE' ? 'Kept. Its reports are closed.'
      : action === 'HIDE' ? 'Hidden from readers. Its reports are closed.'
      : 'Done. Its reports are closed.');
  }catch(err){
    notify(err.message, 'error');
  }
  renderMain();
}

function reportCard(g){
  const p = g.preview;
  const key = `${g.targetType}:${g.targetId}`;
  const author = p?.author;
  const reasons = Object.entries(g.reasons)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `<span class="pill REPORT">${esc(REASON_LABEL[reason] || reason)}${n > 1 ? ` × ${n}` : ''}</span>`)
    .join('');
  return `
    <article class="report-card" aria-label="${g.count} report${g.count === 1 ? '' : 's'} on ${esc(p?.title || p?.kind || 'removed content')}">
      <div class="report-head">
        <div><strong>${g.count} report${g.count === 1 ? '' : 's'}</strong>
          <span class="hint">· first ${fmtDate(g.firstReportedAt)}</span></div>
        <div class="report-reasons">${reasons}</div>
      </div>
      ${p ? `
        <div class="report-body">
          ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="">` : ''}
          <div class="report-content">
            <div class="report-kind">${esc(p.kind)} · <span class="vis ${p.visibility === 'Live' ? 'live' : ''}">${esc(p.visibility)}</span></div>
            ${p.title ? `<h3>${esc(p.title)}</h3>` : ''}
            ${p.text ? `<p>${esc(p.text)}</p>` : ''}
            ${author && g.targetType !== 'USER' ? `<div class="hint">By ${esc(author.name)}${author.isSuspended ? ' · suspended' : ''}</div>` : ''}
            ${p.note ? `<div class="hint">${esc(p.note)}</div>` : ''}
            ${p.crew ? `<div class="hint">Crew named: ${p.crew.driver ? `driver ${esc(p.crew.driver)}` : 'no driver'}${p.crew.conductor ? `, conductor ${esc(p.crew.conductor)}` : ''}
              · ${p.crew.fromTrip ? 'from the trip log' : p.crew.driver || p.crew.conductor ? 'from the bus’s roster' : 'crew unknown'} · written ${fmtDate(p.writtenAt)}</div>` : ''}
          </div>
        </div>` : `
        <div class="empty" style="padding:6px 0">This content has already been removed. Close the reports to clear it from the queue.</div>`}
      ${g.details.length ? `
        <details class="report-details">
          <summary>What reporters said (${g.details.length})</summary>
          <ul>${g.details.map((d) => `
            <li><b>${esc(REASON_LABEL[d.reason] || d.reason)}:</b> ${esc(d.detail)}
              <span class="hint">· ${esc(d.reporter)}, ${fmtDate(d.at)}</span></li>`).join('')}</ul>
        </details>` : ''}
      ${g.wrongCrew && p ? crewFixPanel(g.targetId) : ''}
      <div class="row-actions" style="margin-top:12px">
        ${p ? `
          ${g.wrongCrew && state.moderation.crewFix?.reviewId !== g.targetId ? `<button class="btn btn-sm btn-brand" data-action="openCrewFix" data-id="${g.targetId}">Fix the crew</button>` : ''}
          <button class="btn btn-sm" data-action="decideReport" data-key="${key}" data-act="APPROVE">Keep it</button>
          ${['POST', 'COMMENT', 'BUS_REVIEW'].includes(g.targetType) ? `<button class="btn btn-sm" data-action="decideReport" data-key="${key}" data-act="HIDE">Hide</button>` : ''}
          <button class="btn btn-sm btn-danger" data-action="decideReport" data-key="${key}" data-act="DELETE">${removeLabel(g.targetType)}</button>
          ${author && !author.isSuspended && g.targetType !== 'USER'
            ? `<button class="btn btn-sm btn-ghost" data-action="suspendUser" data-id="${author.id}">Suspend ${esc(author.name)}</button>` : ''}
        ` : `<button class="btn btn-sm" data-action="decideReport" data-key="${key}" data-act="APPROVE">Close reports</button>`}
      </div>
    </article>`;
}

/* ---- crew disputes: a bus company says a review names the wrong driver ---- */

/** The bus's trips around the review, to move it to the right crew or to "crew unknown". */
function crewFixPanel(reviewId){
  const fix = state.moderation.crewFix;
  if(fix?.reviewId !== reviewId) return '';
  const o = fix.options;
  const trip = (t) => `<label class="crew-option"><input type="radio" name="tripId" value="${t.id}" ${t.current ? 'checked' : ''}>
    <span><b>${esc(fmtDate(t.departAt))}</b> · ${esc(t.route || 'No route')} ${t.direction === 'REVERSE' ? '(return)' : ''}
      · driver ${esc(t.driver || 'not recorded')}${t.conductor ? `, conductor ${esc(t.conductor)}` : ''}${t.current ? ' · <i>named now</i>' : ''}</span></label>`;
  return `<form class="crew-fix" data-submit="reassignCrew" data-id="${reviewId}">
    <p class="hint">Review written ${esc(fmtDate(o.review.writtenAt))} on ${esc(o.review.bus.plateNo || '')} (${esc(o.review.bus.company || '')}).
      ${o.disputes.map((d) => d.detail ? `The company says: “${esc(d.detail)}”` : '').join(' ')}</p>
    <fieldset><legend>Who was on duty?</legend>
      ${o.trips.length ? o.trips.map(trip).join('') : '<p class="hint">This bus logged no trips in the day before the review.</p>'}
      <label class="crew-option"><input type="radio" name="tripId" value="" ${o.review.tripId ? '' : 'checked'}><span><b>Crew unknown</b> · take the review off every crew member</span></label>
    </fieldset>
    <label for="crew-note-${reviewId}">Note for the audit log</label>
    <input id="crew-note-${reviewId}" name="note" required minlength="3" maxlength="500" placeholder="e.g. Trip log shows Hari drove the 07:00 run">
    <div class="row-actions" style="margin-top:10px">
      <button class="btn btn-sm btn-brand" type="submit">Move the review</button>
      <button class="btn btn-sm" type="button" data-action="closeCrewFix">Cancel</button>
    </div>
    <p class="hint">Only who the review is about changes. Its stars and words stay as the passenger wrote them, and the reviewer is never shown.</p>
  </form>`;
}

async function openCrewFix(reviewId){
  try{
    state.moderation.crewFix = { reviewId, options: await api(`/moderation/bus-reviews/${reviewId}/crew`) };
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

async function reassignCrew(form, ev){
  ev.preventDefault();
  const tripId = form.elements.tripId.value || null;
  try{
    await api(`/moderation/bus-reviews/${form.dataset.id}/crew`, { method: 'POST', body: { tripId, note: form.elements.note.value.trim() } });
    state.moderation.crewFix = null;
    notify(tripId ? 'Review moved to that trip’s crew. The dispute is closed.' : 'Review is now “crew unknown”. The dispute is closed.');
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

async function screenModeration(){
  await loadModeration();
  renderSidebar();
  const m = state.moderation;
  const q = m.queue;
  const tabs = [
    ['reports', `Reports (${q.reportedItems})`],
    ['posts', `Posts (${m.posts.length})`],
    ['comments', `Comments (${m.comments.length})`],
    ['reviews', `Reviews (${m.reviews.length})`],
    ['busreviews', `Bus reviews (${m.busReviews.length})`],
  ];
  return `
    <div class="top-row"><h2>Moderation</h2></div>
    <div class="stat-grid">
      <div class="stat"><b>${q.reportedItems}</b><span>Reported items${q.slaBreached ? ' · oldest over 24 h' : ''}</span></div>
      <div class="stat"><b>${q.pendingPosts}</b><span>Posts awaiting review</span></div>
      <div class="stat"><b>${q.pendingComments}</b><span>Comments awaiting review</span></div>
      <div class="stat"><b>${q.pendingReviews}</b><span>Reviews awaiting review</span></div>
      <div class="stat"><b>${q.pendingBusReviews || 0}</b><span>Bus reviews held</span></div>
    </div>
    <div class="filters" role="tablist" aria-label="Moderation queues">
      ${tabs.map(([k, l]) => `<button role="tab" aria-selected="${m.tab === k}" class="btn ${m.tab === k ? 'btn-brand' : ''}"
        data-action="setModerationTab" data-tab="${k}">${l}</button>`).join('')}
    </div>
    ${m.tab === 'reports' ? (m.reports.length
      ? m.reports.map(reportCard).join('')
      : '<div class="empty">No open reports. Everything readers flagged has been dealt with.</div>') : ''}
    ${m.tab === 'posts' ? modTable(m.posts, 'POST', [
        {label:'Title', render:(p)=>p.title}, {label:'Author', render:(p)=>p.author?.name || '—'},
        {label:'Why', render:(p)=>p.moderationNote || 'Held by the word filter'},
      ]) : ''}
    ${m.tab === 'comments' ? modTable(m.comments, 'COMMENT', [
        {label:'Comment', render:(c)=>c.body?.slice(0,120)}, {label:'By', render:(c)=>c.user?.name || '—'},
      ]) : ''}
    ${m.tab === 'reviews' ? modTable(m.reviews, 'REVIEW', [
        {label:'Business', render:(r)=>r.business?.name || '—'}, {label:'Rating', render:(r)=>r.rating},
        {label:'By', render:(r)=>r.user?.name || '—'},
      ]) : ''}
    ${m.tab === 'busreviews' ? modTable(m.busReviews, 'BUS_REVIEW', [
        {label:'Bus', render:(r)=>r.vehicle?.plateNo || '—'}, {label:'Company', render:(r)=>r.vehicle?.operator?.name || '—'},
        {label:'Rating', render:(r)=>`${r.overall}★`},
        {label:'Review', render:(r)=>[r.comment, r.suggestion && `Suggestion: ${r.suggestion}`].filter(Boolean).join(' · ').slice(0, 160) || '—'},
      ]) : ''}`;
}

/* =========================== users =========================== */

async function loadUsers(){
  const u = state.users;
  const params = new URLSearchParams({ limit: '50' });
  if(u.role) params.set('role', u.role);
  if(u.suspendedOnly) params.set('suspendedOnly', 'true');
  const data = await api(`/users/admin/directory?${params}`);
  u.items = data.items || data;
}

const ROLE_LABEL = {
  READER: 'Reader', CONTRIBUTOR: 'Contributor', BUSINESS_OWNER: 'Business owner',
  OPERATOR_ADMIN: 'Bus operator admin', MODERATOR: 'Moderator', EDITOR: 'Editor', ADMIN: 'Admin',
};

/** A name for dialogs, whether the person was opened from Users or from a report card. */
function personName(id){
  return state.users.items.find((x) => x.id === id)?.name
    || state.moderation.reports.map((g) => g.preview?.author).find((a) => a?.id === id)?.name
    || 'this account';
}

async function suspendUser(id){
  const days = await askDialog({
    title: `Suspend ${personName(id)}?`,
    message: 'They lose access straight away and cannot sign in until the suspension ends.',
    confirmLabel: 'Suspend',
    danger: true,
    field: {
      type: 'number', label: 'Days (leave empty to suspend until you lift it)', min: 1, max: 3650,
      validate: (v) => (!v || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3650)
        ? '' : 'Enter a whole number of days between 1 and 3650, or leave it empty.'),
    },
  });
  if(days === null) return;
  try{
    await api(`/users/${id}/suspend`, { method: 'PATCH', body: { days: days ? Number(days) : null } });
    notify(days ? `Suspended for ${days} day${days === '1' ? '' : 's'}.` : 'Suspended until lifted.');
  }catch(err){
    notify(err.message, 'error');
  }
  if(state.screen === 'users') await loadUsers();
  renderMain();
}

async function unsuspendUser(id){
  try{
    await api(`/users/${id}/unsuspend`, { method: 'PATCH' });
    notify('Suspension lifted.');
  }catch(err){
    notify(err.message, 'error');
  }
  await loadUsers(); renderMain();
}

async function changeRole(id, current){
  const role = await askDialog({
    title: `Change ${personName(id)}’s role`,
    message: 'Changing a role signs the person out. Editors, moderators, operator admins and admins set up an authenticator app at their next sign-in.',
    confirmLabel: 'Change role',
    field: { type: 'select', label: 'Role', value: current, options: Object.entries(ROLE_LABEL) },
  });
  if(role === null || role === current) return;
  try{
    await api(`/users/${id}/role`, { method: 'PATCH', body: { role } });
    notify(`Role changed to ${ROLE_LABEL[role]}.`);
  }catch(err){
    notify(err.message, 'error');
  }
  await loadUsers(); renderMain();
}

async function resetMfaFor(id){
  const ok = await askDialog({
    title: `Reset ${personName(id)}’s authenticator?`,
    message: 'Use this when someone has lost their phone. They set up a new authenticator at their next sign-in, and the reset is recorded in the audit log.',
    confirmLabel: 'Reset authenticator',
    danger: true,
  });
  if(!ok) return;
  try{
    await api(`/users/${id}/reset-mfa`, { method: 'PATCH' });
    notify('Authenticator reset.');
  }catch(err){
    notify(err.message, 'error');
  }
}

async function screenUsers(){
  await loadUsers();
  const u = state.users;
  const role = state.auth?.user?.role;
  const isAdmin = role === 'ADMIN';
  return `
    <div class="top-row"><h2>Users</h2></div>
    <div class="filters">
      <select data-change="filterUsersRole">
        ${['', 'READER', 'CONTRIBUTOR', 'BUSINESS_OWNER', 'OPERATOR_ADMIN', 'MODERATOR', 'EDITOR', 'ADMIN'].map(r =>
          `<option value="${r}" ${u.role===r?'selected':''}>${r || 'All roles'}</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:6px;margin:0">
        <input type="checkbox" style="width:auto" ${u.suspendedOnly?'checked':''}
          data-change="filterUsersSuspended"> Suspended only
      </label>
    </div>
    ${!u.items.length ? '<div class="empty">No users match.</div>' : `
      <table><thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${u.items.map(x => `
          <tr>
            <td>${esc(x.name)}</td><td>${esc(x.phone || '—')}</td><td>${x.role}</td>
            <td>${x.isSuspended ? '<span class="pill REJECTED">Suspended</span>' : '<span class="pill APPROVED">Active</span>'}</td>
            <td class="row-actions">
              ${x.isSuspended
                ? `<button class="btn btn-sm btn-brand" data-action="unsuspendUser" data-id="${x.id}">Unsuspend</button>`
                : `<button class="btn btn-sm" data-action="suspendUser" data-id="${x.id}">Suspend</button>`}
              ${isAdmin ? `<button class="btn btn-sm" data-action="changeRole" data-id="${x.id}" data-role="${x.role}">Change role</button>` : ''}
              ${isAdmin ? `<button class="btn btn-sm" data-action="resetMfaFor" data-id="${x.id}">Reset MFA</button>` : ''}
            </td>
          </tr>`).join('')}
      </tbody></table>`}`;
}

/* =========================== overview (admin only) =========================== */

async function screenOverview(){
  const [overview, subs, audit] = await Promise.all([
    api('/admin/overview?days=30'), api('/admin/subscriptions'), api('/admin/audit-log?take=30'),
  ]);
  state.overview = overview; state.subscriptions = subs; state.auditLog = audit;
  return `
    <div class="top-row"><h2>Overview</h2><span class="pill">Last ${overview.periodDays} days</span></div>
    <div class="stat-grid">
      <div class="stat"><b>${overview.reach.scans}</b><span>QR scans</span></div>
      <div class="stat"><b>${overview.reach.returnRate}%</b><span>Return rate</span></div>
      <div class="stat"><b>${overview.audience.totalUsers}</b><span>Total users</span></div>
      <div class="stat"><b>${overview.audience.publishedArticles}</b><span>Published articles</span></div>
      <div class="stat"><b>${overview.queues.totalOutstanding}</b><span>Outstanding moderation${overview.queues.slaBreached?' — SLA breached':''}</span></div>
      <div class="stat"><b>${overview.commercial.activeBusinesses}</b><span>Active businesses</span></div>
      <div class="stat"><b>${overview.commercial.couponConversionRate}%</b><span>Coupon conversion</span></div>
    </div>

    <h3 style="margin-bottom:10px">Subscriptions</h3>
    ${!subs.length ? '<div class="empty">No paid listings.</div>' : `
      <table><thead><tr><th>Business</th><th>Tier</th><th>Days remaining</th><th></th></tr></thead>
      <tbody>
        ${subs.map(s => `
          <tr><td>${esc(s.name)}</td><td>${s.tier}</td>
          <td>${s.lapsed ? '<span class="pill REJECTED">Lapsed</span>' : (s.daysRemaining ?? '—')}</td><td></td></tr>`).join('')}
      </tbody></table>`}

    <h3 style="margin:26px 0 10px">Audit log</h3>
    ${!audit.length ? '<div class="empty">No recent privileged actions.</div>' : `
      <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
      <tbody>
        ${audit.map(a => `
          <tr>
            <td>${fmtDate(a.createdAt)}</td><td>${esc(a.moderator?.name || '—')}</td>
            <td>${a.action}</td><td>${a.targetType} · ${a.targetId.slice(0,8)}…</td><td>${esc(a.note || '—')}</td>
          </tr>`).join('')}
      </tbody></table>`}`;
}

/* =========================== ads (admin only) =========================== */

const PLACEMENTS = {
  TOP_BANNER: 'Top banner (Read screen)',
  BETWEEN_STORIES: 'Between magazine stories',
  ARTICLE_TOP: 'Top of articles',
  ARTICLE_BOTTOM: 'Bottom of articles',
  VLOG_FEED: 'Between traveller vlogs',
  TRIP_PLANNER: 'Trips screen (journey planner)',
  ROUTE_GUIDE: 'Inside a route guide',
  MAP_SCREEN: 'Maps screen',
  MORE_SCREEN: 'More screen',
  BUS_PAGE: 'Bus profile page',
  CREATOR_PROFILE: 'Creator profiles',
  SEARCH_RESULTS: 'Bus search results',
  WEB_HOME_HERO: 'Website: home page spotlight',
  WEB_SECTION_SPONSOR: 'Website: magazine section sponsor',
  WEB_SPONSORED_ARTICLE: 'Website: sponsored story card',
  WEB_DESTINATION_SPONSOR: 'Website: place page sponsor',
  WEB_DEALS: 'Website: deals listing',
  WEB_NEWSLETTER: 'Website: newsletter slot',
};
const AD_STATUS_LABEL = { ACTIVE: 'Active', SCHEDULED: 'Scheduled', PAUSED: 'Paused', EXPIRED: 'Expired' };
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function adTiming(ad){
  if(ad.status === 'EXPIRED') return 'Ended';
  if(ad.status === 'SCHEDULED'){
    const days = Math.max(1, Math.ceil((new Date(ad.startsAt) - Date.now()) / 86_400_000));
    return `Starts in ${plural(days, 'day')}`;
  }
  return `${plural(ad.daysLeft, 'day')} left`;
}

async function screenAds(){
  const a = state.ads;
  await loadReferenceData();
  const q = new URLSearchParams({ ...(a.status ? { status: a.status } : {}), ...(a.surface ? { surface: a.surface } : {}) });
  a.items = await api(`/ads/admin?${q}`);
  return `
    <div class="top-row">
      <h2>Ads</h2>
      <button class="btn btn-primary" data-action="openAdForm">+ New ad</button>
    </div>
    <div class="filters">
      <select aria-label="Filter ads by status" data-change="setAdStatusFilter">
        ${['', 'ACTIVE', 'SCHEDULED', 'PAUSED', 'EXPIRED'].map((s) =>
          `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s ? AD_STATUS_LABEL[s] : 'All ads'}</option>`).join('')}
      </select>
      <select aria-label="Filter ads by where they show" data-change="setAdSurfaceFilter">
        ${[['', 'App and website'], ['app', 'In the app'], ['web', 'On the website']].map(([k, l]) =>
          `<option value="${k}" ${a.surface === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${a.flash ? `<div class="error" role="alert" style="margin-bottom:12px">${esc(a.flash)}</div>` : ''}
    ${!a.items.length ? '<div class="empty">No ads here yet. Create one to fill a slot.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Ad</th><th>Placement</th><th>Status</th><th>Runs</th><th>Views</th><th>Clicks</th><th></th></tr></thead>
        <tbody>
          ${a.items.map((ad) => `
            <tr>
              <td><div class="ad-cell"><img src="${esc(ad.imageUrl)}" alt="">
                <div><strong>${esc(ad.title)}</strong><br>
                <small>${esc(ad.advertiserName)} · ${ad.linkType === 'EXTERNAL' ? 'Opens website' : 'Overview page'}</small></div></div></td>
              <td>${esc(PLACEMENTS[ad.placement] || ad.placement)}
                <div class="hint">${ad.routes?.length ? esc(ad.routes.map((r) => r.code).join(', ')) : 'All routes'}</div></td>
              <td><span class="pill ${ad.status}">${AD_STATUS_LABEL[ad.status]}</span></td>
              <td>${fmtDay(ad.startsAt)} – ${fmtDay(ad.endsAt)}<br>
                <small>${adTiming(ad)}</small></td>
              ${ad.site
                ? `<td>${ad.site.views}<div class="hint">on the website</div></td><td>${ad.site.clicks}</td>`
                : `<td>${ad.impressions}</td><td>${ad.clicks} <small>(${ad.ctr}%)</small></td>`}
              <td class="row-actions">
                <button class="btn btn-sm" data-action="openAdForm" data-id="${ad.id}">Edit</button>
                ${ad.status !== 'EXPIRED'
                  ? `<button class="btn btn-sm" data-action="toggleAd" data-id="${ad.id}" data-active="${!ad.isActive}">${ad.isActive ? 'Pause' : 'Resume'}</button>` : ''}
                <button class="btn btn-sm btn-danger" data-action="askDeleteAd" data-id="${ad.id}">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}
    ${a.editing ? adForm(a.editing) : ''}
    ${a.confirmDelete ? confirmDeleteAdDialog(a.items.find((x) => x.id === a.confirmDelete)) : ''}`;
}

function imageField(id, label, url, hint){
  return `
    <label>${label}</label>
    <div class="cover-field">
      <div id="${id}-preview" class="cover-preview">${url ? `<img src="${esc(url)}" alt="">` : '<span>No image yet</span>'}</div>
      <div>
        <input id="${id}" type="hidden" value="${esc(url)}">
        <button class="btn btn-sm" type="button" data-action="pickFile" data-target="${id}-file">Upload image</button>
        <div id="${id}-status" class="hint" aria-live="polite">${hint}</div>
        <input id="${id}-file" class="sr-only" type="file" accept="image/*" tabindex="-1" aria-label="Choose ${label.toLowerCase()}"
               data-change="uploadAdImage" data-field="${id}">
      </div>
    </div>`;
}

/** webOnly: opened from Website → Ads, so only the website's slots are offered and corridors do not apply. */
function adForm(ad, { webOnly = false } = {}){
  const isNew = !ad.id;
  const placements = Object.entries(PLACEMENTS).filter(([k]) => !webOnly || k.startsWith('WEB_'));
  const v = (k) => esc(ad[k] ?? '');
  const link = ad.linkType || 'EXTERNAL';
  return `
    <div class="modal-back" data-action="backdrop" data-closer="closeAdForm">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ad-form-title">
        <h2 id="ad-form-title" style="margin-bottom:6px">${isNew ? (webOnly ? 'New website ad' : 'New ad') : 'Edit ad'}</h2>
        <div class="ad-form-grid">
          <form id="ad-form" novalidate data-submit="saveAd" data-id="${isNew ? '' : ad.id}"
                data-input="updateAdPreview" data-change="updateAdPreview">
            ${imageField('ad-image', 'Ad image', ad.imageUrl, 'Wide images work best, about 3:2')}
            <label for="ad-title">Headline</label>
            <input id="ad-title" maxlength="120" value="${v('title')}" aria-label="Headline"
                   placeholder="Stay two nights, the third is free">
            <div class="two-col">
              <div><label for="ad-advertiser">Advertiser</label>
                <input id="ad-advertiser" maxlength="80" value="${v('advertiserName')}"></div>
              <div><label for="ad-tagline">Tagline <small>(optional)</small></label>
                <input id="ad-tagline" maxlength="160" value="${v('tagline')}"></div>
            </div>
            <label for="ad-placement">Where it appears</label>
            <select id="ad-placement">
              ${placements.map(([k, l]) =>
                `<option value="${k}" ${(ad.placement || (webOnly ? 'WEB_HOME_HERO' : 'BETWEEN_STORIES')) === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <div class="two-col">
              <div><label for="ad-target-category">Section it sponsors <small>(section sponsor only)</small></label>
                <select id="ad-target-category"><option value="">—</option>
                  ${state.categories.map((c) => `<option value="${esc(c.id)}" ${ad.targetCategoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
              <div><label for="ad-target-destination">Place it sponsors <small>(place sponsor only)</small></label>
                <select id="ad-target-destination"><option value="">—</option>
                  ${state.destinations.map((d) => `<option value="${esc(d.id)}" ${ad.targetDestinationId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
            </div>
            <div ${webOnly ? 'hidden' : ''}>
            <label for="ad-routes">Show only to travellers on these routes <small>(optional)</small></label>
            <select id="ad-routes" multiple size="4">
              ${state.routes.map((r) => `<option value="${esc(r.id)}" ${(ad.routeIds || []).includes(r.id) ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
            <div class="hint">Leave all unselected to show the ad everywhere. Hold ⌘ or Ctrl to pick several.</div>
            </div>
            <div class="two-col">
              <div><label for="ad-start">Starts</label>
                <input id="ad-start" type="date" value="${isoDay(ad.startsAt ? new Date(ad.startsAt) : new Date())}"></div>
              <div><label for="ad-count">Runs for</label>
                <div class="inline-fields">
                  <input id="ad-count" type="number" min="1" max="52" value="${ad.durationCount ?? 1}">
                  <select id="ad-unit" aria-label="Duration unit">
                    ${[['DAY', 'day(s)'], ['WEEK', 'week(s)'], ['MONTH', 'month(s)']].map(([u, l]) =>
                      `<option value="${u}" ${(ad.durationUnit || 'WEEK') === u ? 'selected' : ''}>${l}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
            <div id="ad-ends" class="hint"></div>
            <fieldset class="link-choice">
              <legend>When someone taps the ad</legend>
              <label><input type="radio" name="ad-link" value="EXTERNAL" ${link === 'EXTERNAL' ? 'checked' : ''} data-change="toggleAdLink"
                            aria-label="Open the advertiser's website">
                Open the advertiser's website</label>
              <label><input type="radio" name="ad-link" value="OVERVIEW" ${link === 'OVERVIEW' ? 'checked' : ''} data-change="toggleAdLink"
                            aria-label="Show an overview page inside Batoma">
                Show an overview page inside Batoma</label>
            </fieldset>
            <div id="ad-external-fields">
              <label for="ad-url">Website link</label>
              <input id="ad-url" type="url" placeholder="https://" value="${v('externalUrl')}">
            </div>
            <div id="ad-overview-fields">
              <label for="ad-ov-title">Overview heading</label>
              <input id="ad-ov-title" maxlength="120" value="${v('overviewTitle')}">
              <label for="ad-ov-body">Overview text</label>
              <textarea id="ad-ov-body" maxlength="5000" style="min-height:120px;font-family:inherit">${v('overviewBody')}</textarea>
              ${imageField('ad-ov-image', 'Overview image', ad.overviewImageUrl, 'Optional; the ad image is used if empty')}
            </div>
            <div id="ad-form-error" class="error" role="alert" hidden></div>
            <div class="row-actions" style="margin-top:18px">
              <button id="ad-save" class="btn btn-primary" type="submit">${isNew ? 'Create ad' : 'Save changes'}</button>
              <button class="btn btn-ghost" type="button" data-action="closeAdForm">Cancel</button>
            </div>
          </form>
          <div class="ad-preview-col" aria-live="polite">
            <div class="hint" style="margin:0 0 8px">How readers will see it</div>
            <div id="ad-preview"></div>
          </div>
        </div>
      </div>
    </div>`;
}

function adFormValues(){
  const unit = $('#ad-unit').value;
  const count = Math.max(1, Number($('#ad-count').value) || 1);
  const picked = $('#ad-start').value;
  // Today means "start now"; any other day starts at local midnight.
  const start = !picked || picked === isoDay(new Date()) ? new Date() : new Date(`${picked}T00:00:00`);
  const end = new Date(start);
  if(unit === 'MONTH'){
    // Match the server: clamp to the month's last day so 31 Jan + 1 month is 28 Feb, not 3 March.
    const day = end.getDate();
    end.setDate(1);
    end.setMonth(end.getMonth() + count);
    end.setDate(Math.min(day, new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()));
  }else{
    end.setDate(end.getDate() + count * (unit === 'WEEK' ? 7 : 1));
  }
  const linkType = document.querySelector('input[name="ad-link"]:checked')?.value || 'EXTERNAL';
  return { unit, count, start, end, linkType };
}

function toggleAdLink(){
  if(!$('#ad-form')) return;
  const external = adFormValues().linkType === 'EXTERNAL';
  $('#ad-external-fields').hidden = !external;
  $('#ad-overview-fields').hidden = external;
}

function updateAdPreview(){
  const box = $('#ad-preview');
  if(!box) return;
  const f = adFormValues();
  const img = $('#ad-image').value;
  const tagline = $('#ad-tagline').value.trim();
  box.innerHTML = `
    <div class="adp ${$('#ad-placement').value === 'TOP_BANNER' ? 'adp-banner' : ''}">
      <div class="adp-rule"><span>Sponsored</span></div>
      <div class="adp-body">
        ${img ? `<img src="${esc(img)}" alt="">` : '<div class="adp-noimg">Ad image</div>'}
        <div class="adp-copy">
          <div class="adp-from">${esc($('#ad-advertiser').value.trim() || 'Advertiser')}</div>
          <h3>${esc($('#ad-title').value.trim() || 'Your headline')}</h3>
          ${tagline ? `<p>${esc(tagline)}</p>` : ''}
          <span class="adp-cta">${f.linkType === 'EXTERNAL' ? 'Visit website' : 'See the offer'} →</span>
        </div>
      </div>
    </div>`;
  $('#ad-ends').textContent = `Runs ${fmtDay(f.start)} to ${fmtDay(f.end)}`;
}

async function uploadAdImage(files, fieldId){
  if(!files.length) return;
  const status = $(`#${fieldId}-status`);
  status.textContent = 'Uploading…';
  try{
    const { files: saved } = await uploadImages(files.slice(0, 1));
    $(`#${fieldId}`).value = saved[0].url;
    $(`#${fieldId}-preview`).innerHTML = `<img src="${esc(saved[0].url)}" alt="">`;
    status.textContent = 'Uploaded.';
    updateAdPreview();
  }catch(err){
    status.textContent = err.message;
  }
}

function showAdError(message){
  const box = $('#ad-form-error');
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

/** Errors are shown in place, never by re-rendering, so nothing the admin typed is lost. */
async function saveAd(e, id){
  e.preventDefault();
  $('#ad-form-error').hidden = true;
  const f = adFormValues();
  const dto = {
    title: $('#ad-title').value.trim(),
    advertiserName: $('#ad-advertiser').value.trim(),
    tagline: $('#ad-tagline').value.trim() || undefined,
    imageUrl: $('#ad-image').value,
    placement: $('#ad-placement').value,
    durationUnit: f.unit,
    durationCount: f.count,
    startsAt: f.start.toISOString(),
    linkType: f.linkType,
    externalUrl: f.linkType === 'EXTERNAL' ? $('#ad-url').value.trim() : undefined,
    overviewTitle: f.linkType === 'OVERVIEW' ? $('#ad-ov-title').value.trim() : undefined,
    overviewBody: f.linkType === 'OVERVIEW' ? ($('#ad-ov-body').value.trim() || undefined) : undefined,
    overviewImageUrl: f.linkType === 'OVERVIEW' ? ($('#ad-ov-image').value || undefined) : undefined,
    // Always sent, so clearing every route means "show everywhere" rather than "leave as it was".
    routeIds: [...$('#ad-routes').selectedOptions].map((o) => o.value),
    targetCategoryId: $('#ad-target-category').value || undefined,
    targetDestinationId: $('#ad-target-destination').value || undefined,
  };
  if(!dto.imageUrl){ showAdError('Upload an image for the ad first.'); return; }

  const btn = $('#ad-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    if(id) await api(`/ads/admin/${id}`, { method: 'PATCH', body: dto });
    else await api('/ads/admin', { method: 'POST', body: dto });
    state.ads.editing = null;
    state.ads.flash = '';
    renderMain();
  }catch(err){
    showAdError(err.message);
    btn.disabled = false; btn.textContent = id ? 'Save changes' : 'Create ad';
  }
}

function openAdForm(id){
  state.ads.editing = id ? state.ads.items.find((x) => x.id === id) : {};
  state.ads.flash = '';
  renderMain();
}
function closeAdForm(){ state.ads.editing = null; renderMain(); }

async function toggleAd(id, isActive){
  try{
    await api(`/ads/admin/${id}/active`, { method: 'PATCH', body: { isActive } });
    state.ads.flash = '';
  }catch(err){
    state.ads.flash = err.message;
  }
  renderMain();
}

function askDeleteAd(id){ state.ads.confirmDelete = id; renderMain(); }

function confirmDeleteAdDialog(ad){
  if(!ad) return '';
  return `
    <div class="modal-back" data-action="backdrop" data-closer="cancelDeleteAd">
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-ad-title" style="max-width:460px">
        <h2 id="del-ad-title" style="margin-bottom:8px">Delete this ad?</h2>
        <p style="margin:0">"${esc(ad.title)}" from ${esc(ad.advertiserName)} stops showing straight away, and its view and
          click counts are lost. Pausing keeps them.</p>
        <div class="row-actions" style="margin-top:18px">
          <button class="btn btn-danger" data-action="deleteAd" data-id="${ad.id}">Delete ad</button>
          <button class="btn btn-ghost" data-action="cancelDeleteAd">Keep it</button>
        </div>
      </div>
    </div>`;
}

async function deleteAd(id){
  try{
    await api(`/ads/admin/${id}`, { method: 'DELETE' });
    state.ads.flash = '';
  }catch(err){
    state.ads.flash = err.message;
  }
  state.ads.confirmDelete = null;
  renderMain();
}

/* =========================== bus companies (admin only) =========================== */

const FLEET_STATUS = {
  PENDING: ['Waiting for verification', 'PENDING'], VERIFIED: ['Verified', 'APPROVED'],
  REJECTED: ['Not approved', 'REJECTED'], SUSPENDED: ['Suspended', 'REJECTED'],
};
const fleetPill = (s) => `<span class="pill ${FLEET_STATUS[s][1]}">${FLEET_STATUS[s][0]}</span>`;

async function screenFleet(){
  const f = state.fleet;
  const params = new URLSearchParams();
  if(f.status) params.set('status', f.status);
  if(f.q) params.set('q', f.q);
  const [stats, items] = await Promise.all([api('/fleet/admin/stats'), api(`/fleet/admin/companies?${params}`)]);
  f.stats = stats; f.items = items;
  return `
    <div class="top-row"><h2>Bus companies</h2>
      <a class="btn btn-sm" href="owner.html" target="_blank" rel="noopener">Owner portal ↗</a></div>
    <div class="stat-grid">
      <div class="stat"><b>${stats.buses.registered}</b><span>Buses registered with Batoma · ${stats.buses.active} active</span></div>
      <div class="stat"><b>${stats.companies.total}</b><span>Companies · ${stats.companies.verified} verified</span></div>
      <div class="stat"><b>${stats.companies.pending}</b><span>Waiting for verification</span></div>
      <div class="stat"><b>${stats.reviews.total}</b><span>Bus reviews${stats.reviews.average != null ? ` · ${stats.reviews.average}★ average` : ''}</span></div>
      <div class="stat"><b>${stats.openIncidents}</b><span>Open breakdowns</span></div>
      <div class="stat"><b>${stats.profileScansLast30Days}</b><span>Bus QR scans, last 30 days</span></div>
    </div>
    <form class="filters" data-submit="searchFleet">
      <select aria-label="Verification status" data-change="setFleetStatus">
        <option value="">All companies</option>
        ${Object.entries(FLEET_STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input name="q" type="search" placeholder="Name, PAN, phone or number plate" value="${esc(f.q)}" aria-label="Search companies">
      <button class="btn" type="submit">Search</button>
    </form>
    ${!items.length ? '<div class="empty">No companies match.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Company</th><th>Owner</th><th>Contact</th><th>Buses</th><th>Rating</th><th>Status</th><th>Registered</th><th></th></tr></thead>
        <tbody>${items.map((c) => `
          <tr>
            <td><b>${esc(c.name)}</b>${c.registrationNo ? `<div class="hint">${esc(c.registrationNo)}</div>` : ''}
              ${c.verificationNote ? `<div class="hint">Note: ${esc(c.verificationNote)}</div>` : ''}</td>
            <td>${c.owners.map((o) => `${esc(o.name)}<div class="hint">${esc(o.email || '')}</div>`).join('') || '—'}</td>
            <td>${esc(c.contactPhone || '—')}${c.contactEmail ? `<div class="hint">${esc(c.contactEmail)}</div>` : ''}</td>
            <td>${c.buses}<div class="hint">${c.crew} crew</div></td>
            <td>${c.rating.reviews ? `${c.rating.average}★<div class="hint">${c.rating.reviews} reviews</div>` : '—'}</td>
            <td>${fleetPill(c.verification)}</td>
            <td><small>${fmtDate(c.createdAt)}</small></td>
            <td class="row-actions">
              <button class="btn btn-sm" data-action="viewCompany" data-id="${c.id}">View</button>
              ${c.verification !== 'VERIFIED' ? `<button class="btn btn-sm btn-brand" data-action="setCompanyStatus" data-id="${c.id}" data-status="VERIFIED">Verify</button>` : ''}
              ${c.verification === 'PENDING' ? `<button class="btn btn-sm" data-action="setCompanyStatus" data-id="${c.id}" data-status="REJECTED">Reject</button>` : ''}
              ${c.verification === 'VERIFIED' ? `<button class="btn btn-sm btn-danger" data-action="setCompanyStatus" data-id="${c.id}" data-status="SUSPENDED">Suspend</button>` : ''}
            </td>
          </tr>`).join('')}</tbody></table></div>`}
    <p class="hint">A company's buses and QR codes are public only while it is verified. Check the owner's details, and a bluebook or PAN
      document where needed, before verifying: a verified badge tells passengers the company is who it says it is.</p>`;
}

async function setCompanyStatus(id, status){
  const name = state.fleet.items.find((x) => x.id === id)?.name || 'this company';
  const copy = {
    VERIFIED: [`Verify ${name}?`, 'Its buses become public and their QR codes start working. The owners are notified.', 'Verify company', false],
    REJECTED: [`Reject ${name}?`, 'The owners see your reason in their portal and can correct their details to resubmit.', 'Reject', true],
    SUSPENDED: [`Suspend ${name}?`, 'Its buses are hidden from passengers and every QR code is paused until you verify it again.', 'Suspend', true],
  }[status];
  const needsReason = status !== 'VERIFIED';
  const note = await askDialog({
    title: copy[0], message: copy[1], confirmLabel: copy[2], danger: copy[3],
    field: {
      type: 'textarea', label: needsReason ? 'Reason (shown to the company)' : 'Note (optional)',
      validate: (v) => (needsReason && !v ? 'Give the company a reason.' : ''),
    },
  });
  if(note === null) return;
  try{
    await api(`/fleet/admin/companies/${id}/verification`, { method: 'PATCH', body: { status, note: note || undefined } });
    notify(status === 'VERIFIED' ? `${name} is verified.` : status === 'REJECTED' ? `${name} was not approved.` : `${name} is suspended.`);
  }catch(err){
    notify(err.message, 'error');
  }
  document.querySelector('.company-modal')?.remove();
  renderMain();
}

async function viewCompany(id){
  let c;
  try{ c = await api(`/fleet/admin/companies/${id}`); }catch(err){ notify(err.message, 'error'); return; }
  const back = document.createElement('div');
  back.className = 'modal-back company-modal';
  back.innerHTML = `
    <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
      <div class="top-row" style="margin-bottom:6px"><h2 id="cmp-title">${esc(c.name)}</h2>
        <button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <p style="margin:0 0 10px">${fleetPill(c.verification)} ${c.verificationNote ? `<span class="hint">${esc(c.verificationNote)}</span>` : ''}</p>
      <div class="two-col">
        <div><label>Registration or PAN</label>${esc(c.registrationNo || '—')}</div>
        <div><label>Phone</label>${esc(c.contactPhone || '—')}</div>
        <div><label>Email</label>${esc(c.contactEmail || '—')}</div>
        <div><label>Address</label>${esc(c.address || '—')}</div>
      </div>
      ${c.description ? `<p>${esc(c.description)}</p>` : ''}
      <h3 style="margin:18px 0 8px">Team</h3>
      <div class="table-wrap"><table style="min-width:0"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Since</th></tr></thead>
        <tbody>${c.members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.email || '—')}</td><td>${esc(m.phone || '—')}</td>
          <td>${({ OWNER: 'Owner', MANAGER: 'Manager', CREW: 'Crew' })[m.role] || esc(m.role)}</td><td><small>${fmtDate(m.since)}</small></td></tr>`).join('')}</tbody></table></div>
      <div class="top-row" style="margin:18px 0 8px"><h3 style="margin:0">Buses (${c.buses.length})</h3>
        ${c.buses.some((b) => b.isActive) ? `<button class="btn btn-sm" data-action="adminFleetStickers" data-id="${c.id}">All stickers (A4 sheets)</button>` : ''}</div>
      ${c.buses.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Registration</th><th>Name</th><th>Seats</th><th>Status</th><th>Sticker</th></tr></thead>
        <tbody>${c.buses.map((b) => `<tr><td><b>${esc(b.registrationNo)}</b></td><td>${esc(b.label || '—')}</td><td>${b.seatCount ?? '—'}</td>
          <td>${b.isActive ? esc(b.status.replace('_', ' ').toLowerCase()) : 'archived'}</td>
          <td class="row-actions">${b.isActive ? `
            <button class="btn btn-sm" data-action="adminBusSticker" data-id="${b.id}" data-format="pdf" data-size="a6">A6</button>
            <button class="btn btn-sm" data-action="adminBusSticker" data-id="${b.id}" data-format="pdf" data-size="seat">Seat</button>
            <button class="btn btn-sm" data-action="adminBusSticker" data-id="${b.id}" data-format="png">PNG</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No buses registered yet.</div>'}
      <h3 style="margin:18px 0 8px">Verification documents</h3>
      <div id="cmp-docs" data-operator="${esc(c.id)}"><div class="hint">Loading…</div></div>
      <h3 style="margin:18px 0 8px">Verification history</h3>
      ${c.history.length ? `<ul style="margin:0;padding-left:18px">${c.history.map((h) => `<li>${fmtDate(h.createdAt)}: ${esc(h.action)} by ${esc(h.moderator?.name || '—')}${h.note ? `. ${esc(h.note)}` : ''}</li>`).join('')}</ul>`
        : '<div class="empty">No decisions yet.</div>'}
      <div class="row-actions" style="margin-top:18px">
        ${c.verification !== 'VERIFIED' ? `<button class="btn btn-brand" data-action="setCompanyStatus" data-id="${c.id}" data-status="VERIFIED">Verify</button>` : ''}
        ${c.verification === 'PENDING' ? `<button class="btn" data-action="setCompanyStatus" data-id="${c.id}" data-status="REJECTED">Reject</button>` : ''}
        ${c.verification === 'VERIFIED' ? `<button class="btn btn-danger" data-action="setCompanyStatus" data-id="${c.id}" data-status="SUSPENDED">Suspend</button>` : ''}
      </div>
    </div>`;
  const returnFocus = document.activeElement;
  const close = () => { back.remove(); returnFocus?.focus?.(); };
  back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-close]')) close(); });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
  document.body.appendChild(back);
  back.querySelector('[data-close]').focus();
  fillDocuments(back.querySelector('#cmp-docs'), { operatorId: c.id });
}

const DOC_KIND_LABEL = {
  PAN: 'PAN certificate', COMPANY_REGISTRATION: 'Company registration', BLUEBOOK: 'Bluebook',
  ROUTE_PERMIT: 'Route permit', BUSINESS_LICENCE: 'Business licence', OTHER: 'Other document',
};

/** Documents a company or business sent for verification. Each open is recorded in the audit log. */
async function fillDocuments(box, owner){
  if(!box) return;
  try{
    const docs = await api(`/admin/verification-documents?${new URLSearchParams(owner)}`);
    box.innerHTML = docs.length ? `<ul class="doc-list">${docs.map((d) => `<li>
        <span><b>${esc(DOC_KIND_LABEL[d.kind] || d.kind)}</b> <span class="hint">${d.mimeType === 'application/pdf' ? 'PDF' : 'Photo'} · ${fmtDay(d.createdAt)}</span></span>
        <button class="btn btn-sm" data-action="openVerificationDoc" data-id="${esc(d.id)}">Open</button></li>`).join('')}</ul>
        <p class="hint">Links last five minutes; every look is in the security events.</p>`
      : '<div class="empty">No documents sent yet. Ask the owner to upload a PAN or registration certificate.</div>';
  }catch(err){ box.innerHTML = `<div class="error">${esc(err.message)}</div>`; }
}

async function openVerificationDoc(id){
  try{ const { url } = await api(`/admin/verification-documents/${id}/link`); window.open(url, '_blank', 'noopener'); }
  catch(err){ notify(err.message, 'error'); }
}

/* =========================== route guides =========================== */

const STOP_KINDS = {
  LANDMARK: ['Landmark', '🏛'], VIEWPOINT: ['Viewpoint', '🌄'], FOOD: ['Food stop', '🍛'], HOTEL: ['Hotel', '🛏'],
  REST_STOP: ['Rest stop', '🚻'], FUEL: ['Fuel', '⛽'], ATM: ['ATM', '🏧'], HOSPITAL: ['Hospital', '🏥'],
  TEMPLE: ['Temple', '🛕'], SHOPPING: ['Shopping', '🛍'], ACTIVITY: ['Activity', '🧗'], OTHER: ['Other', '📍'],
};
const DIRECTIONS = { BOTH: 'Both ways', FORWARD: 'Start → end only', REVERSE: 'End → start only' };
const GUIDE_KINDS = { ROUTE: 'Road guide (along a route)', DESTINATION: 'Place itinerary (day by day)' };
const routeOf = (id) => state.routes.find((r) => r.id === id);
const journeyText = (g) => {
  if(g.kind === 'DESTINATION'){
    const d = g.destination || state.destinations.find((x) => x.id === g.destinationId);
    return d ? `${d.name}${g.dayCount ? ` · ${plural(g.dayCount, 'day')}` : ''}` : '—';
  }
  const r = g.route || routeOf(g.routeId);
  if(!r) return '—';
  return g.direction === 'REVERSE' ? `${r.endPlace} → ${r.startPlace}`
    : g.direction === 'FORWARD' ? `${r.startPlace} → ${r.endPlace}`
    : `${r.startPlace} ⇄ ${r.endPlace}`;
};

async function screenGuides(){
  const g = state.guides;
  await loadReferenceData();
  const params = new URLSearchParams();
  if(g.status) params.set('status', g.status);
  if(g.routeId) params.set('routeId', g.routeId);
  if(g.kind) params.set('kind', g.kind);
  g.items = await api(`/guides/admin?${params}`);
  return `
    <div class="top-row"><h2>Route guides</h2>
      <div class="row-actions">
        <button class="btn" data-action="openRouteForm">+ New route</button>
        <button class="btn" data-action="openDestinationForm">+ New place</button>
        <button class="btn btn-primary" data-action="openGuideForm">+ New guide</button>
      </div>
    </div>
    <p class="hint" style="margin:-8px 0 14px">What travellers see on the Trips screen. A <strong>road guide</strong> lists the landmarks,
      food stops and hotels along a route in the order they pass them; a <strong>place itinerary</strong> lays a destination out day by day.
      Add the routes and places you need, then write the guide for each.</p>
    <div class="filters">
      <select aria-label="Filter by status" data-change="setGuideFilter" data-field="status">
        ${['', 'DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) =>
          `<option value="${s}" ${g.status === s ? 'selected' : ''}>${s ? s[0] + s.slice(1).toLowerCase() : 'All guides'}</option>`).join('')}
      </select>
      <select aria-label="Filter by kind" data-change="setGuideFilter" data-field="kind">
        <option value="">Roads and places</option>
        ${Object.entries(GUIDE_KINDS).map(([k, l]) => `<option value="${k}" ${g.kind === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select aria-label="Filter by route" data-change="setGuideFilter" data-field="routeId">
        <option value="">All routes</option>
        ${state.routes.map((r) => `<option value="${esc(r.id)}" ${g.routeId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      </select>
    </div>
    ${g.flash ? `<div class="error" role="alert" style="margin-bottom:12px">${esc(g.flash)}</div>` : ''}
    ${!g.items.length ? '<div class="empty">No guides yet. Create one for a route, then add the stops along it.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Guide</th><th>Road or place</th><th>Shown</th><th>Stops</th><th>Status</th><th></th></tr></thead>
        <tbody>${g.items.map((x) => `
          <tr>
            <td><strong>${esc(x.title)}</strong>
              <div class="hint">${x.kind === 'DESTINATION' ? 'Place itinerary' : 'Road guide'}</div>
              ${x.summary ? `<div class="hint">${esc(x.summary.slice(0, 90))}</div>` : ''}</td>
            <td>${esc(journeyText(x))}<div class="hint">${esc(x.route?.code || x.destination?.district || '')}</div></td>
            <td>${x.kind === 'DESTINATION' ? 'Day by day' : esc(DIRECTIONS[x.direction])}</td>
            <td>${x.stopCount}</td>
            <td><span class="pill ${x.status}">${x.status[0] + x.status.slice(1).toLowerCase()}</span></td>
            <td class="row-actions">
              <button class="btn btn-sm btn-brand" data-action="openStops" data-id="${x.id}">Stops</button>
              <button class="btn btn-sm" data-action="openGuideForm" data-id="${x.id}">Edit</button>
              ${x.status === 'PUBLISHED'
                ? `<button class="btn btn-sm" data-action="setGuideStatus" data-id="${x.id}" data-status="DRAFT">Unpublish</button>`
                : `<button class="btn btn-sm" data-action="setGuideStatus" data-id="${x.id}" data-status="PUBLISHED">Publish</button>`}
              <button class="btn btn-sm btn-danger" data-action="deleteGuide" data-id="${x.id}">Delete</button>
            </td>
          </tr>`).join('')}</tbody></table></div>`}
    ${g.editing ? guideForm(g.editing) : ''}
    ${g.stopsFor ? stopsPanel(g.stopsFor) : ''}`;
}

function guideForm(guide){
  const isNew = !guide.id;
  const v = (k) => esc(guide[k] ?? '');
  return `
    <div class="modal-back" data-action="backdrop" data-closer="closeGuideForm">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="guide-form-title">
        <h2 id="guide-form-title" style="margin-bottom:10px">${isNew ? 'New route guide' : 'Edit guide'}</h2>
        <form id="guide-form" novalidate data-submit="saveGuide" data-id="${isNew ? '' : guide.id}">
          <label for="guide-kind">What kind of guide</label>
          <select id="guide-kind" data-change="toggleGuideKind">
            ${Object.entries(GUIDE_KINDS).map(([k, l]) =>
              `<option value="${k}" ${(guide.kind || 'ROUTE') === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <div id="guide-route-fields">
            <label for="guide-route">Route</label>
            <select id="guide-route">
              ${state.routes.map((r) => `<option value="${esc(r.id)}" ${guide.routeId === r.id ? 'selected' : ''}>${esc(r.name)} (${esc(r.code)})</option>`).join('')}
            </select>
            <div class="hint">Not listed? Close this and use “New route”.</div>
            <label for="guide-direction">Which way round</label>
            <select id="guide-direction">
              ${Object.entries(DIRECTIONS).map(([k, l]) =>
                `<option value="${k}" ${(guide.direction || 'BOTH') === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <div class="hint">“Both ways” is written once in the start → end order; travellers going the other way see it reversed.</div>
          </div>
          <div id="guide-destination-fields">
            <label for="guide-destination">Place</label>
            <select id="guide-destination">
              ${state.destinations.map((d) => `<option value="${esc(d.id)}" ${guide.destinationId === d.id ? 'selected' : ''}>${esc(d.name)}${d.district ? ` (${esc(d.district)})` : ''}</option>`).join('')}
            </select>
            <div class="hint">Not listed? Close this and use “New place”.</div>
            <label for="guide-days">How many days</label>
            <input id="guide-days" type="number" min="1" max="60" value="${esc(guide.dayCount ?? 3)}">
            <div class="hint">Each stop is then filed under a day number.</div>
          </div>
          <label for="guide-title">Title</label>
          <input id="guide-title" maxlength="140" value="${v('title')}" placeholder="e.g. Kathmandu to Pokhara: where to stop">
          <label for="guide-summary">Summary <small>(optional)</small></label>
          <textarea id="guide-summary" maxlength="600" style="min-height:80px;font-family:inherit">${v('summary')}</textarea>
          ${imageField('guide-cover', 'Cover image (optional)', guide.coverImageUrl, 'Wide images work best')}
          <div id="guide-form-error" class="error" role="alert" hidden></div>
          <div class="row-actions" style="margin-top:18px">
            <button id="guide-save" class="btn btn-primary" type="submit">${isNew ? 'Create guide' : 'Save changes'}</button>
            <button class="btn btn-ghost" type="button" data-action="closeGuideForm">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
}

function openGuideForm(id){
  state.guides.editing = id
    ? state.guides.items.find((x) => x.id === id)
    : { kind: 'ROUTE', direction: 'BOTH', routeId: state.routes[0]?.id, destinationId: state.destinations[0]?.id };
  state.guides.flash = '';
  renderMain();
}
function closeGuideForm(){ state.guides.editing = null; renderMain(); }

/** A guide belongs to a route or to a place, so only one set of fields applies. */
function toggleGuideKind(){
  const kind = $('#guide-kind')?.value;
  if(!kind) return;
  $('#guide-route-fields').hidden = kind !== 'ROUTE';
  $('#guide-destination-fields').hidden = kind !== 'DESTINATION';
}

async function saveGuide(e, id){
  e.preventDefault();
  const box = $('#guide-form-error');
  box.hidden = true;
  const kind = $('#guide-kind').value;
  const dto = {
    kind,
    routeId: kind === 'ROUTE' ? $('#guide-route').value : undefined,
    destinationId: kind === 'DESTINATION' ? $('#guide-destination').value : undefined,
    dayCount: kind === 'DESTINATION' ? Number($('#guide-days').value) || undefined : undefined,
    direction: kind === 'ROUTE' ? $('#guide-direction').value : 'BOTH',
    title: $('#guide-title').value.trim(),
    summary: $('#guide-summary').value.trim() || undefined,
    coverImageUrl: $('#guide-cover').value || undefined,
  };
  if(kind === 'ROUTE' && !dto.routeId){ box.textContent = 'Add a route first, then write its guide.'; box.hidden = false; return; }
  if(kind === 'DESTINATION' && !dto.destinationId){ box.textContent = 'Add a place first, then write its itinerary.'; box.hidden = false; return; }
  if(dto.title.length < 3){ box.textContent = 'Give the guide a title.'; box.hidden = false; return; }
  const btn = $('#guide-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const saved = id ? await api(`/guides/admin/${id}`, { method: 'PATCH', body: dto })
      : await api('/guides/admin', { method: 'POST', body: dto });
    state.guides.editing = null;
    notify('Guide saved.');
    if(!id) state.guides.stopsFor = saved.id;
    renderMain();
  }catch(err){
    box.textContent = err.message; box.hidden = false;
    btn.disabled = false; btn.textContent = id ? 'Save changes' : 'Create guide';
  }
}

async function setGuideStatus(id, status){
  try{
    await api(`/guides/admin/${id}/status`, { method: 'PATCH', body: { status } });
    notify(status === 'PUBLISHED' ? 'Guide published. Travellers can see it now.' : 'Guide unpublished.');
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

async function deleteGuide(id){
  const guide = state.guides.items.find((x) => x.id === id);
  const ok = await askDialog({
    title: `Delete “${guide?.title}”?`,
    message: 'The guide and all its stops are removed. Travellers stop seeing it straight away.',
    confirmLabel: 'Delete guide', danger: true,
  });
  if(!ok) return;
  try{ await api(`/guides/admin/${id}`, { method: 'DELETE' }); notify('Guide deleted.'); }
  catch(err){ notify(err.message, 'error'); }
  renderMain();
}

/* ---- stops ---- */

async function openStops(guideId){
  state.guides.stopsFor = guideId;
  state.guides.editingStop = null;
  state.guides.detail = await api(`/guides/admin/${guideId}`).catch(() => null);
  renderMain();
}
function closeStops(){ state.guides.stopsFor = null; state.guides.detail = null; state.guides.editingStop = null; renderMain(); }

function stopsPanel(){
  const guide = state.guides.detail;
  if(!guide) return '';
  const stops = guide.stops || [];
  return `
    <div class="modal-back" data-action="backdrop" data-closer="closeStops">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="stops-title">
        <div class="top-row" style="margin-bottom:6px">
          <div><h2 id="stops-title">${esc(guide.title)}</h2>
            <div class="hint">${esc(journeyText(guide))} · ${plural(stops.length, 'stop')} in travel order</div></div>
          <button class="btn btn-ghost btn-sm" data-action="closeStops">Close</button>
        </div>
        ${state.guides.editingStop ? stopForm(state.guides.editingStop) : `
          <button class="btn btn-primary" data-action="openStopForm">+ Add a stop</button>`}
        ${!stops.length ? '<div class="empty">No stops yet. Add the places travellers pass, in order.</div>' : `
          <div class="table-wrap" style="margin-top:12px"><table>
            <thead><tr><th>${guide.kind === 'DESTINATION' ? 'Day' : '#'}</th><th>Stop</th><th>Kind</th>
              <th>${guide.kind === 'DESTINATION' ? 'Timing' : 'Along the way'}</th><th></th></tr></thead>
            <tbody>${stops.map((s, i) => `
              <tr>
                <td>${guide.kind === 'DESTINATION' ? `Day ${s.dayNumber ?? 1}` : i + 1}</td>
                <td><strong>${esc(s.name)}</strong>${s.isHighlight ? ' <span class="pill APPROVED">Highlight</span>' : ''}
                  ${s.description ? `<div class="hint">${esc(s.description.slice(0, 80))}</div>` : ''}</td>
                <td>${STOP_KINDS[s.kind]?.[1] || ''} ${esc(STOP_KINDS[s.kind]?.[0] || s.kind)}</td>
                <td>${s.distanceFromStartKm != null ? `${s.distanceFromStartKm} km` : '—'}
                  ${s.minutesFromStart != null ? `<div class="hint">${Math.floor(s.minutesFromStart / 60)}h ${s.minutesFromStart % 60}m in</div>` : ''}</td>
                <td class="row-actions">
                  <button class="btn btn-sm" data-action="moveStop" data-index="${i}" data-by="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
                  <button class="btn btn-sm" data-action="moveStop" data-index="${i}" data-by="1" ${i === stops.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
                  <button class="btn btn-sm" data-action="openStopForm" data-id="${s.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-action="deleteStop" data-id="${s.id}">Delete</button>
                </td>
              </tr>`).join('')}</tbody></table></div>`}
      </div>
    </div>`;
}

/** A town or area an itinerary can be written for. Sits beside "New route". */
function openDestinationForm(){
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="dest-title" novalidate>
      <h2 id="dest-title" style="margin-bottom:8px">New place</h2>
      <p class="hint" style="margin:0">A town or area you can write a day-by-day itinerary for, such as Pokhara or Sauraha.</p>
      <div class="two-col">
        <div><label for="dest-name">Name</label><input id="dest-name" maxlength="120" placeholder="Bandipur"></div>
        <div><label for="dest-district">District</label><input id="dest-district" maxlength="80" placeholder="Tanahun"></div>
      </div>
      <div class="two-col">
        <div><label for="dest-lat">Latitude</label><input id="dest-lat" type="number" step="0.0001" placeholder="27.9333"></div>
        <div><label for="dest-lng">Longitude</label><input id="dest-lng" type="number" step="0.0001" placeholder="84.4167"></div>
      </div>
      <label for="dest-desc">Description <small>(optional)</small></label>
      <textarea id="dest-desc" maxlength="1000" style="min-height:70px;font-family:inherit"></textarea>
      <div class="error" role="alert" hidden></div>
      <div class="row-actions" style="margin-top:16px">
        <button class="btn btn-primary" type="submit">Create place</button>
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
      </div>
    </form>`;
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-cancel]')) close(); });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
  back.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = back.querySelector('.error');
    const dto = {
      name: back.querySelector('#dest-name').value.trim(),
      district: back.querySelector('#dest-district').value.trim(),
      latitude: Number(back.querySelector('#dest-lat').value),
      longitude: Number(back.querySelector('#dest-lng').value),
      description: back.querySelector('#dest-desc').value.trim() || undefined,
    };
    if(!dto.name || !dto.district || !Number.isFinite(dto.latitude) || !Number.isFinite(dto.longitude)){
      box.textContent = 'Name, district and both coordinates are needed.'; box.hidden = false; return;
    }
    const submit = back.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Creating…';
    try{
      await api('/places/destinations', { method: 'POST', body: dto });
      state.destinations = [];
      await loadReferenceData();
      close();
      notify(`${dto.name} added.`);
      renderMain();
    }catch(err){
      box.textContent = err.message; box.hidden = false;
      submit.disabled = false; submit.textContent = 'Create place';
    }
  });
  document.body.appendChild(back);
  back.querySelector('#dest-name').focus();
}

function stopForm(stop){
  const isNew = !stop.id;
  const v = (k) => esc(stop[k] ?? '');
  return `
    <form id="stop-form" novalidate data-submit="saveStop" data-id="${isNew ? '' : stop.id}"
          style="border:1px solid var(--line);border-radius:var(--r);padding:14px;margin-top:10px">
      <h3 style="font-size:17px;margin-bottom:8px">${isNew ? 'Add a stop' : 'Edit stop'}</h3>
      <div class="two-col">
        <div><label for="stop-kind">Kind</label>
          <select id="stop-kind">${Object.entries(STOP_KINDS).map(([k, [l, icon]]) =>
            `<option value="${k}" ${(stop.kind || 'LANDMARK') === k ? 'selected' : ''}>${icon} ${l}</option>`).join('')}</select></div>
        <div><label for="stop-name">Name</label>
          <input id="stop-name" maxlength="140" value="${v('name')}" placeholder="e.g. Kurintar riverside tea shops"></div>
      </div>
      ${state.guides.detail?.kind === 'DESTINATION' ? `
        <label for="stop-day">Day</label>
        <input id="stop-day" type="number" min="1" max="60" value="${esc(stop.dayNumber ?? 1)}">
        <div class="hint">Which day of the itinerary this belongs to.</div>` : ''}
      <label for="stop-desc">Description <small>(optional)</small></label>
      <textarea id="stop-desc" maxlength="2000" style="min-height:70px;font-family:inherit">${v('description')}</textarea>
      <div class="two-col">
        <div><label for="stop-km">Kilometres from the start <small>(optional)</small></label>
          <input id="stop-km" type="number" min="0" max="2000" value="${v('distanceFromStartKm')}"></div>
        <div><label for="stop-min">Minutes from the start <small>(optional)</small></label>
          <input id="stop-min" type="number" min="0" max="10000" value="${v('minutesFromStart')}"></div>
      </div>
      <div class="two-col">
        <div><label for="stop-price">Price from (NPR) <small>(optional)</small></label>
          <input id="stop-price" type="number" min="0" value="${v('priceFromNpr')}"></div>
        <div><label for="stop-hours">Opening hours <small>(optional)</small></label>
          <input id="stop-hours" maxlength="120" value="${v('openingHours')}" placeholder="e.g. 6am – 8pm"></div>
      </div>
      <div class="two-col">
        <div><label for="stop-phone">Phone <small>(optional)</small></label>
          <input id="stop-phone" maxlength="40" value="${v('contactPhone')}"></div>
        <div><label for="stop-tip">Tip for travellers <small>(optional)</small></label>
          <input id="stop-tip" maxlength="300" value="${v('tip')}" placeholder="e.g. Ask for the fish curry"></div>
      </div>
      ${imageField('stop-image', 'Photo (optional)', stop.imageUrl, 'One photo of the place')}
      <div class="checks"><label><input type="checkbox" id="stop-highlight" ${stop.isHighlight ? 'checked' : ''}> Highlight this stop</label></div>
      <div id="stop-form-error" class="error" role="alert" hidden></div>
      <div class="row-actions" style="margin-top:14px">
        <button id="stop-save" class="btn btn-primary" type="submit">${isNew ? 'Add stop' : 'Save stop'}</button>
        <button class="btn btn-ghost" type="button" data-action="cancelStopEdit">Cancel</button>
      </div>
    </form>`;
}

function openStopForm(id){
  const stops = state.guides.detail?.stops || [];
  state.guides.editingStop = id ? stops.find((s) => s.id === id) : { kind: 'LANDMARK' };
  renderMain();
}

async function saveStop(e, id){
  e.preventDefault();
  const box = $('#stop-form-error');
  box.hidden = true;
  const numberOrUndefined = (sel) => ($(sel).value === '' ? undefined : Number($(sel).value));
  const dto = {
    kind: $('#stop-kind').value,
    dayNumber: $('#stop-day') ? Number($('#stop-day').value) || 1 : undefined,
    name: $('#stop-name').value.trim(),
    description: $('#stop-desc').value.trim() || undefined,
    distanceFromStartKm: numberOrUndefined('#stop-km'),
    minutesFromStart: numberOrUndefined('#stop-min'),
    priceFromNpr: numberOrUndefined('#stop-price'),
    openingHours: $('#stop-hours').value.trim() || undefined,
    contactPhone: $('#stop-phone').value.trim() || undefined,
    tip: $('#stop-tip').value.trim() || undefined,
    imageUrl: $('#stop-image').value || undefined,
    isHighlight: $('#stop-highlight').checked,
  };
  if(dto.name.length < 2){ box.textContent = 'Give the stop a name.'; box.hidden = false; return; }
  const btn = $('#stop-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    const guideId = state.guides.stopsFor;
    state.guides.detail = id
      ? await api(`/guides/admin/stops/${id}`, { method: 'PATCH', body: dto })
      : await api(`/guides/admin/${guideId}/stops`, { method: 'POST', body: dto });
    state.guides.editingStop = null;
    notify('Stop saved.');
    renderMain();
  }catch(err){
    box.textContent = err.message; box.hidden = false;
    btn.disabled = false; btn.textContent = id ? 'Save stop' : 'Add stop';
  }
}

async function deleteStop(id){
  const ok = await askDialog({ title: 'Delete this stop?', confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ state.guides.detail = await api(`/guides/admin/stops/${id}`, { method: 'DELETE' }); notify('Stop deleted.'); }
  catch(err){ notify(err.message, 'error'); }
  renderMain();
}

async function moveStop(index, delta){
  const stops = [...(state.guides.detail?.stops || [])];
  const target = index + delta;
  if(target < 0 || target >= stops.length) return;
  [stops[index], stops[target]] = [stops[target], stops[index]];
  try{
    state.guides.detail = await api(`/guides/admin/${state.guides.stopsFor}/stops/reorder`, {
      method: 'POST', body: { ids: stops.map((s) => s.id) },
    });
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

/* ---- routes ---- */

function openRouteForm(){
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <form class="modal" role="dialog" aria-modal="true" aria-labelledby="route-title" novalidate>
      <h2 id="route-title" style="margin-bottom:8px">New route</h2>
      <p class="hint" style="margin:0">A corridor travellers ride, such as Kathmandu – Pokhara. Guides, ads and articles can all be aimed at it.</p>
      <div class="two-col">
        <div><label for="route-code">Short code</label><input id="route-code" maxlength="20" placeholder="KTM-BGL"></div>
        <div><label for="route-name">Name</label><input id="route-name" maxlength="120" placeholder="Kathmandu – Baglung"></div>
      </div>
      <div class="two-col">
        <div><label for="route-start">Starts at</label><input id="route-start" maxlength="60" placeholder="Kathmandu"></div>
        <div><label for="route-end">Ends at</label><input id="route-end" maxlength="60" placeholder="Baglung"></div>
      </div>
      <div class="two-col">
        <div><label for="route-km">Distance (km) <small>(optional)</small></label><input id="route-km" type="number" min="1" max="2000"></div>
        <div><label for="route-hours">Typical hours <small>(optional)</small></label><input id="route-hours" type="number" min="1" max="72" step="0.5"></div>
      </div>
      <div class="error" role="alert" hidden></div>
      <div class="row-actions" style="margin-top:16px">
        <button class="btn btn-primary" type="submit">Create route</button>
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
      </div>
    </form>`;
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-cancel]')) close(); });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
  back.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = back.querySelector('.error');
    const dto = {
      code: back.querySelector('#route-code').value.trim().toUpperCase(),
      name: back.querySelector('#route-name').value.trim(),
      startPlace: back.querySelector('#route-start').value.trim(),
      endPlace: back.querySelector('#route-end').value.trim(),
      distanceKm: back.querySelector('#route-km').value ? Number(back.querySelector('#route-km').value) : undefined,
      typicalHours: back.querySelector('#route-hours').value ? Number(back.querySelector('#route-hours').value) : undefined,
    };
    if(!dto.code || !dto.name || !dto.startPlace || !dto.endPlace){
      box.textContent = 'Code, name, start and end are all needed.'; box.hidden = false; return;
    }
    const submit = back.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Creating…';
    try{
      await api('/operators/routes', { method: 'POST', body: dto });
      state.routes = [];
      await loadReferenceData();
      close();
      notify(`Route ${dto.name} created.`);
      renderMain();
    }catch(err){
      box.textContent = err.message; box.hidden = false;
      submit.disabled = false; submit.textContent = 'Create route';
    }
  });
  document.body.appendChild(back);
  back.querySelector('#route-code').focus();
}

/* =========================== creators =========================== */

const CREATOR_STATUS = { PENDING: ['Waiting', 'PENDING'], APPROVED: ['Approved', 'APPROVED'], SUSPENDED: ['Suspended', 'REJECTED'] };

async function screenCreators(){
  const c = state.creators;
  c.items = await api(`/creators/admin${c.status ? `?status=${c.status}` : ''}`);
  const waiting = c.items.filter((x) => x.status === 'PENDING').length;
  return `
    <div class="top-row"><h2>Creators</h2>
      <a class="btn btn-sm" href="creator.html" target="_blank" rel="noopener">Creator pages ↗</a></div>
    <p class="hint" style="margin:-8px 0 14px">Travellers who applied for a creator profile. Approving one publishes their profile
      and lets their journeys go live; suspending takes both off the public side.</p>
    <div class="filters">
      <select aria-label="Filter creators" data-change="setCreatorStatus">
        ${['', 'PENDING', 'APPROVED', 'SUSPENDED'].map((s) =>
          `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s ? CREATOR_STATUS[s][0] : `All creators${waiting ? ` (${waiting} waiting)` : ''}`}</option>`).join('')}
      </select>
    </div>
    ${!c.items.length ? '<div class="empty">No creator applications yet.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Creator</th><th>Account</th><th>About</th><th>Published</th><th>Status</th><th></th></tr></thead>
        <tbody>${c.items.map((x) => `
          <tr>
            <td><strong>${esc(x.displayName)}</strong><div class="hint">@${esc(x.handle)}${x.isFeatured ? ' · ★ featured' : ''}</div></td>
            <td>${esc(x.user?.name || '—')}<div class="hint">${esc(x.user?.email || x.user?.phone || '')}</div></td>
            <td>${esc(x.headline || x.bio?.slice(0, 80) || '—')}
              ${x.homeBase ? `<div class="hint">${esc(x.homeBase)}</div>` : ''}</td>
            <td>${x.journeys} journeys<div class="hint">${x.posts} adventures</div></td>
            <td><span class="pill ${CREATOR_STATUS[x.status][1]}">${CREATOR_STATUS[x.status][0]}</span>
              ${x.reviewNote ? `<div class="hint">${esc(x.reviewNote)}</div>` : ''}</td>
            <td class="row-actions">
              ${x.status !== 'APPROVED' ? `<button class="btn btn-sm btn-brand" data-action="reviewCreator" data-id="${x.id}" data-status="APPROVED">Approve</button>` : ''}
              ${x.status === 'APPROVED' ? `<button class="btn btn-sm" data-action="featureCreator" data-id="${x.id}" data-featured="${!x.isFeatured}">${x.isFeatured ? 'Unfeature' : 'Feature'}</button>` : ''}
              ${x.status === 'PENDING' ? `<button class="btn btn-sm" data-action="reviewCreator" data-id="${x.id}" data-status="SUSPENDED">Refuse</button>` : ''}
              ${x.status === 'APPROVED' ? `<button class="btn btn-sm btn-danger" data-action="reviewCreator" data-id="${x.id}" data-status="SUSPENDED">Suspend</button>` : ''}
              ${x.status === 'APPROVED' ? `<a class="btn btn-sm" href="creator.html?handle=${encodeURIComponent(x.handle)}" target="_blank" rel="noopener">View</a>` : ''}
            </td>
          </tr>`).join('')}</tbody></table></div>`}`;
}

async function reviewCreator(id, status){
  const creator = state.creators.items.find((x) => x.id === id);
  const approving = status === 'APPROVED';
  const note = await askDialog({
    title: approving ? `Approve @${creator?.handle}?` : `${creator?.status === 'PENDING' ? 'Refuse' : 'Suspend'} @${creator?.handle}?`,
    message: approving
      ? 'Their profile goes public and they can publish journeys. Check their posts read like real travel writing first.'
      : 'Their profile and journeys leave the public side. They see your reason in their creator panel.',
    confirmLabel: approving ? 'Approve' : 'Confirm',
    danger: !approving,
    field: {
      type: 'textarea', label: approving ? 'Welcome note (optional)' : 'Reason (shown to them)',
      validate: (v) => (!approving && !v ? 'Give them a reason.' : ''),
    },
  });
  if(note === null) return;
  try{
    state.creators.items = await api(`/creators/admin/${id}`, { method: 'PATCH', body: { status, note: note || undefined } });
    notify(approving ? 'Creator approved.' : 'Done.');
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

async function featureCreator(id, isFeatured){
  try{
    state.creators.items = await api(`/creators/admin/${id}`, { method: 'PATCH', body: { status: 'APPROVED', isFeatured } });
    notify(isFeatured ? 'Featured on the creators page.' : 'No longer featured.');
  }catch(err){ notify(err.message, 'error'); }
  renderMain();
}

const SCREENS = {
  overview: screenOverview, fleet: screenFleet, ads: screenAds, articles: screenArticles, issues: screenIssues,
  guides: screenGuides, creators: screenCreators, moderation: screenModeration, users: screenUsers,
};

/* =========================== appearance =========================== */

/**
 * Palettes for the whole platform, not only this panel: each one is a background,
 * a surface, a brand colour and an accent that keep text contrast above 4.5:1.
 */
const PALETTES = [
  ['', 'Prayer Flag', 'Batoma’s own: cream paper, dusk purple, saffron', ['#F2EEE3', '#5B3FA8', '#F4A024', '#E8455F']],
  ['dawn', 'Himalaya Dawn', 'Cool morning blue, calm for long editing sessions', ['#EDF2F8', '#2F5D9E', '#F0883F', '#12243B']],
  ['teahouse', 'Teahouse', 'Warm sand and brass, like an old lodge dining room', ['#F4EADC', '#8A5A2B', '#D98E04', '#3A2A18']],
  ['rhododendron', 'Rhododendron', 'Nepal’s national flower: soft pink with a deep red', ['#FAEFF1', '#A82848', '#E8455F', '#2C1420']],
  ['forest', 'Forest Trail', 'Green hills, easy on the eye in daylight', ['#EDF3ED', '#2F6B3F', '#6FAE3F', '#132318']],
  ['slate', 'Slate', 'Neutral grey, lets photos and ads show their own colour', ['#EEF0F3', '#3C4A5A', '#C97B2C', '#14181D']],
  ['nightbus', 'Night Bus', 'Dark mode for working at night, same as the reader app', ['#141024', '#8B6FD4', '#E8A33F', '#EDE7F7']],
];

function applyPalette(name){
  if(name) document.documentElement.dataset.palette = name;
  else delete document.documentElement.dataset.palette;
  try{ localStorage.setItem('bato.admin.palette', name || ''); }catch(_){}
}

/**
 * The platform's own look, shared by every traveller: the same palettes and
 * Nepali backgrounds the reader app knows how to paint. Saved on the server, so
 * changing it here changes Batoma for everyone.
 */
const APP_PALETTES = [
  ['prayer-flag', 'Prayer Flag', 'Batoma’s own: cream paper, dusk purple, saffron', ['#FDFAF3', '#5B3FA8', '#F4A024', '#E8455F']],
  ['rhododendron', 'Rhododendron', 'Nepal’s national flower: soft pink with a deep red', ['#FDF1F3', '#A82848', '#E8455F', '#2C1420']],
  ['himalaya-dawn', 'Himalaya Dawn', 'First light on the snow: cool blue and a warm sunrise', ['#EEF3FA', '#2F5D9E', '#F0883F', '#12243B']],
  ['teahouse', 'Teahouse', 'Warm sand and brass, like an old lodge dining room', ['#F6EDDF', '#8A5A2B', '#D98E04', '#3A2A18']],
  ['forest-trail', 'Forest Trail', 'The green mid-hills in daylight', ['#EFF5EF', '#2F6B3F', '#6FAE3F', '#132318']],
  ['monsoon', 'Monsoon', 'Wet slate and paddy green, for the rains', ['#EDF1F1', '#37626B', '#7FA653', '#14201F']],
  ['lakeside-sunset', 'Lakeside Sunset', 'Phewa at dusk: apricot and deep water', ['#FDF0E6', '#B4532A', '#E8934A', '#2A1A14']],
  ['night-bus', 'Night Bus', 'Dark mode for night journeys and late editing', ['#141024', '#8B6FD4', '#E8A33F', '#EDE7F7']],
];

const APP_BACKGROUNDS = [
  ['none', 'Plain', 'Flat colour only'],
  ['rhododendron', 'Rhododendron', 'Soft lali gurans blooms behind the page'],
  ['prayer-flags', 'Prayer flags', 'A faint line of bunting across the top'],
  ['himalaya', 'Himalaya', 'A pale mountain skyline along the bottom'],
  ['terraced-fields', 'Terraced fields', 'Hill terraces as gentle bands'],
  ['newar-lattice', 'Newar lattice', 'Carved window screen, very faint'],
  ['paper-grain', 'Paper grain', 'Lokta paper texture'],
];

async function openPalettePicker(){
  let theme;
  try{ theme = await api('/settings/theme'); }
  catch(err){ notify(err.message, 'error'); return; }
  const isAdmin = state.auth?.user?.role === 'ADMIN';
  const panelPalette = (() => { try{ return localStorage.getItem('bato.admin.palette') || ''; }catch(_){ return ''; } })();

  const back = document.createElement('div');
  back.className = 'modal-back';
  const paint = () => {
    const chosen = APP_PALETTES.find(([v]) => v === theme.themePalette) || APP_PALETTES[0];
    const chosenBg = APP_BACKGROUNDS.find(([v]) => v === theme.themeBackground) || APP_BACKGROUNDS[0];
    back.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <div class="top-row" style="margin-bottom:4px"><h2 id="palette-title">Appearance</h2>
          <button class="btn btn-ghost btn-sm" data-close>Close</button></div>

        <h3 style="font-size:17px;margin-top:14px">Batoma’s colours</h3>
        <p class="hint" style="margin:0">${isAdmin
          ? 'What every traveller sees in the app. Saved for the whole platform.'
          : 'Set by an admin for the whole platform.'}</p>

        <!-- The panel keeps its own colours, so without this an admin clicks a palette and sees nothing change. -->
        <div class="theme-preview" style="--p-bg:${chosen[3][0]};--p-brand:${chosen[3][1]};--p-accent:${chosen[3][2]}">
          <div class="tp-phone" data-bg="${esc(theme.themeBackground)}">
            <div class="tp-mast"><span>BATOMA</span><b>The Prithvi Highway</b></div>
            <div class="tp-body">
              <div class="tp-card"><i></i><span></span><span class="short"></span></div>
              <div class="tp-card"><i></i><span></span><span class="short"></span></div>
            </div>
          </div>
          <div>
            <strong style="font-size:15px">Now showing: ${esc(chosen[1])}${theme.themeBackground !== 'none' ? ` · ${esc(chosenBg[1])}` : ''}</strong>
            <div class="hint" style="margin-top:4px">This is how the traveller app looks right now.
              ${isAdmin ? 'Pick another below and this preview follows.' : ''}</div>
            <a class="btn btn-sm" style="margin-top:8px" href="index.html" target="_blank" rel="noopener">Open the app ↗</a>
          </div>
        </div>
        <div class="palette-grid" role="group" aria-label="App palette">
          ${APP_PALETTES.map(([value, name, note, colours]) => `
            <button class="palette-card" data-app-palette="${value}" aria-pressed="${theme.themePalette === value}" ${isAdmin ? '' : 'disabled'}>
              <strong>${esc(name)}</strong>
              <div class="swatches" aria-hidden="true">${colours.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
              <div class="hint" style="margin-top:6px">${esc(note)}</div>
            </button>`).join('')}
        </div>

        <h3 style="font-size:17px;margin-top:18px">Background</h3>
        <p class="hint" style="margin:0">A Nepali pattern behind the reader app, drawn in the palette's own colours.</p>
        <div class="palette-grid" role="group" aria-label="App background">
          ${APP_BACKGROUNDS.map(([value, name, note]) => `
            <button class="palette-card" data-app-background="${value}" aria-pressed="${theme.themeBackground === value}" ${isAdmin ? '' : 'disabled'}>
              <strong>${esc(name)}</strong>
              <div class="hint" style="margin-top:4px">${esc(note)}</div>
            </button>`).join('')}
        </div>

        <h3 style="font-size:17px;margin-top:18px">This control panel</h3>
        <p class="hint" style="margin:0">Only your browser; every editor keeps their own.</p>
        <div class="palette-grid" role="group" aria-label="Control panel palette">
          ${PALETTES.map(([value, name, note, colours]) => `
            <button class="palette-card" data-palette-value="${value}" aria-pressed="${panelPalette === value}">
              <strong>${esc(name)}</strong>
              <div class="swatches" aria-hidden="true">${colours.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
              <div class="hint" style="margin-top:6px">${esc(note)}</div>
            </button>`).join('')}
        </div>
      </div>`;
  };
  paint();

  const close = () => back.remove();
  const save = async (body, label) => {
    try{
      theme = await api('/settings/theme', { method: 'PATCH', body });
      paint();
      notify(`${label} — every traveller sees this now.`);
    }catch(err){ notify(err.message, 'error'); }
  };
  back.addEventListener('click', async (e) => {
    if(e.target === back || e.target.closest('[data-close]')) return close();
    const app = e.target.closest('[data-app-palette]');
    const bg = e.target.closest('[data-app-background]');
    const panel = e.target.closest('[data-palette-value]');
    if(app) return save({ themePalette: app.dataset.appPalette }, `${app.querySelector('strong').textContent} applied`);
    if(bg) return save({ themeBackground: bg.dataset.appBackground }, `${bg.querySelector('strong').textContent} background applied`);
    if(panel){
      applyPalette(panel.dataset.paletteValue);
      back.querySelectorAll('[data-palette-value]').forEach((c) => c.setAttribute('aria-pressed', String(c === panel)));
      notify(`${panel.querySelector('strong').textContent} applied to your panel.`);
    }
  });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
  document.body.appendChild(back);
  back.querySelector('[data-close]').focus();
}

/* ====================== what the markup may ask for (js/actions.js) ====================== */

/** Dialogs that close when the dimmed area around them is clicked. */
const CLOSERS = {
  closeArticleForm, closeAdForm, closeGuideForm, closeStops,
  cancelDeleteAd: () => { state.ads.confirmDelete = null; renderMain(); },
};
const nullIfBlank = (v) => v || null;

Actions.on({
  // sign-in and shell
  switchLogin: (el) => switchLogin(el.dataset.mode),
  loginRestartPhone: () => {
    state.login = { step: 'phone', phone: '', devCode: '', challengeToken: '', enrol: null, error: '', busy: false };
    renderLogin();
  },
  goSection: (el) => goSection(el.dataset.key),
  openPalettePicker: () => openPalettePicker(),
  signOut: () => signOut(),
  signOutEverywhere: () => signOutEverywhere(),
  newRecoveryCodes: () => newRecoveryCodes(),
  editArticle: (el) => editArticle(el.dataset.id),
  loginStep: (el) => { Object.assign(state.login, { step: el.dataset.step, error: '', busy: false }); renderLogin(); },
  downloadRecoveryCodes: () => downloadRecoveryCodes(),
  recoveryCodesSaved: () => onSignedIn(state.login.pending),
  openVerificationDoc: (el) => openVerificationDoc(el.dataset.id),
  backdrop: (el, ev) => { if(ev.target === el) CLOSERS[el.dataset.closer]?.(); },
  pickFile: (el) => document.getElementById(el.dataset.target)?.click(),
  // articles and issues
  openArticleForm: () => openArticleForm(null),
  closeArticleForm: () => closeArticleForm(),
  clearCover: () => setCover(''),
  publishArticle: (el) => publishArticle(el.dataset.id),
  archiveArticle: (el) => archiveArticle(el.dataset.id),
  deleteArticleForever: (el) => deleteArticleForever(el.dataset.id),
  elevatePost: (el) => elevatePost(el.dataset.id),
  publishIssue: (el) => publishIssue(el.dataset.id),
  // moderation and users
  moderate: (el) => moderate(el.dataset.type, el.dataset.id, el.dataset.act),
  decideReport: (el) => decideReport(el.dataset.key, el.dataset.act),
  openCrewFix: (el) => openCrewFix(el.dataset.id),
  closeCrewFix: () => { state.moderation.crewFix = null; renderMain(); },
  setModerationTab: (el) => { state.moderation.tab = el.dataset.tab; renderMain(); },
  suspendUser: (el) => suspendUser(el.dataset.id),
  unsuspendUser: (el) => unsuspendUser(el.dataset.id),
  changeRole: (el) => changeRole(el.dataset.id, el.dataset.role),
  resetMfaFor: (el) => resetMfaFor(el.dataset.id),
  // ads
  openAdForm: (el) => openAdForm(nullIfBlank(el.dataset.id)),
  closeAdForm: () => closeAdForm(),
  toggleAd: (el) => toggleAd(el.dataset.id, el.dataset.active === 'true'),
  askDeleteAd: (el) => askDeleteAd(el.dataset.id),
  deleteAd: (el) => deleteAd(el.dataset.id),
  cancelDeleteAd: () => CLOSERS.cancelDeleteAd(),
  // bus companies
  viewCompany: (el) => viewCompany(el.dataset.id),
  setCompanyStatus: (el) => setCompanyStatus(el.dataset.id, el.dataset.status),
  // guides
  openRouteForm: () => openRouteForm(),
  openDestinationForm: () => openDestinationForm(),
  openGuideForm: (el) => openGuideForm(nullIfBlank(el.dataset.id)),
  closeGuideForm: () => closeGuideForm(),
  openStops: (el) => openStops(el.dataset.id),
  closeStops: () => closeStops(),
  setGuideStatus: (el) => setGuideStatus(el.dataset.id, el.dataset.status),
  deleteGuide: (el) => deleteGuide(el.dataset.id),
  openStopForm: (el) => openStopForm(nullIfBlank(el.dataset.id)),
  moveStop: (el) => moveStop(Number(el.dataset.index), Number(el.dataset.by)),
  deleteStop: (el) => deleteStop(el.dataset.id),
  cancelStopEdit: () => { state.guides.editingStop = null; renderMain(); },
  // stickers, made by the server
  adminBusSticker: (el) => downloadFile(`/fleet/admin/buses/${el.dataset.id}/qr/sticker?${new URLSearchParams({
    format: el.dataset.format, ...(el.dataset.size ? { size: el.dataset.size } : {}) })}`).catch((err) => notify(err.message, 'error')),
  adminFleetStickers: (el) => downloadFile(`/fleet/admin/companies/${el.dataset.id}/qr/stickers.pdf`).catch((err) => notify(err.message, 'error')),
  // creators
  reviewCreator: (el) => reviewCreator(el.dataset.id, el.dataset.status),
  featureCreator: (el) => featureCreator(el.dataset.id, el.dataset.featured === 'true'),
});

Actions.onSubmit({
  loginSubmitEmail: (el, ev) => loginSubmitEmail(ev),
  loginSubmitPhone: (el, ev) => loginSubmitPhone(ev),
  loginSubmitCode: (el, ev) => loginSubmitCode(ev),
  loginSubmitMfa: (el, ev) => loginSubmitMfa(ev),
  loginSubmitEnrolConfirm: (el, ev) => loginSubmitEnrolConfirm(ev),
  loginSubmitRecover: (el, ev) => loginSubmitRecover(ev),
  saveArticle: (el, ev) => saveArticle(ev, nullIfBlank(el.dataset.id)),
  saveAd: (el, ev) => saveAd(ev, nullIfBlank(el.dataset.id)),
  saveGuide: (el, ev) => saveGuide(ev, nullIfBlank(el.dataset.id)),
  saveStop: (el, ev) => saveStop(ev, nullIfBlank(el.dataset.id)),
  createIssue: (el, ev) => createIssue(ev),
  searchFleet: (el, ev) => { ev.preventDefault(); state.fleet.q = el.elements.q.value.trim(); renderMain(); },
  reassignCrew: (el, ev) => reassignCrew(el, ev),
});

Actions.onChange({
  uploadCover: (el) => { uploadCover([...el.files]); el.value = ''; },
  uploadAdImage: (el) => { uploadAdImage([...el.files], el.dataset.field); el.value = ''; },
  filterArticles: (el) => filterArticles({ [el.dataset.field]: el.value }),
  filterUsersRole: (el) => { state.users.role = el.value; loadUsers().then(renderMain); },
  filterUsersSuspended: (el) => { state.users.suspendedOnly = el.checked; loadUsers().then(renderMain); },
  setAdStatusFilter: (el) => { state.ads.status = el.value; renderMain(); },
  setAdSurfaceFilter: (el) => { state.ads.surface = el.value; renderMain(); },
  // The ad form's own change handler used to run after these too; the preview follows the switch.
  toggleAdLink: () => { toggleAdLink(); updateAdPreview(); },
  updateAdPreview: () => updateAdPreview(),
  setFleetStatus: (el) => { state.fleet.status = el.value; renderMain(); },
  setGuideFilter: (el) => { state.guides[el.dataset.field] = el.value; renderMain(); },
  toggleGuideKind: () => toggleGuideKind(),
  setCreatorStatus: (el) => { state.creators.status = el.value; renderMain(); },
});

Actions.onInput({
  // The summary's character count, so an editor sees the 160 limit coming.
  countSummary: (el) => {
    const n = el.value.length;
    const box = $('#af-summary-count');
    box.textContent = `${n} / 160`;
    box.classList.toggle('near', n > 140);
  },
  updateAdPreview: () => updateAdPreview(),
});

/* =========================== boot =========================== */

try{ applyPalette(localStorage.getItem('bato.admin.palette') || ''); }catch(_){}
loadAuth();
if(state.auth && !['EDITOR','MODERATOR','ADMIN'].includes(state.auth.user?.role)){
  state.auth = null; localStorage.removeItem('bato.admin.auth');
}
// A reload keeps the session but not the screen: start where this role is allowed to be.
if(state.auth && !visibleSections().some(([key]) => key === state.screen)){
  state.screen = defaultScreen(state.auth.user.role);
}
renderRoot();
