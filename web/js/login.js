/* Sign-in for travellers, partners and anyone with an email account (login.html).
   Classic script; markup asks for handlers through web/js/actions.js. */
'use strict';
const API = window.BATO_CONFIG?.api || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
const params = new URLSearchParams(location.search);
// A page of this app only: a name, an optional simple query (creator.html?panel=1 from the
// website's Sign in) and an optional hash. No slashes or scheme, so it can never leave the app.
const safeReturn = (v) => (v && /^[\w.-]+\.html(\?[\w=&-]*)?(#[\w-]*)?$/.test(v) ? v : 'index.html#write');
const returnTo = safeReturn(params.get('returnTo'));

try{ const t = localStorage.getItem('bato.theme'); if(t) document.documentElement.dataset.theme = t; }catch(_){}

const state = {
  // ?mode=register opens on "Create an account" (the website's "Become a creator").
  step: params.get('mode') === 'register' ? 'register' : 'email', name: '', email: '', phone: '', devCode: '', devLink: '',
  error: '', errorCode: '', notice: '', busy: false, showPw: false, resetToken: '', challengeToken: '',
};

const $ = (s) => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, body){
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error(json?.message || 'Something went wrong. Please try again.');
    err.code = json?.code; err.status = res.status;
    throw err;
  }
  return json.data;
}

function go(step, patch = {}){
  Object.assign(state, { error: '', errorCode: '', notice: '', busy: false }, patch, { step });
  render();
  const first = $('#view input');
  if(first) first.focus();
}

function render(){ $('#view').innerHTML = VIEWS[state.step](); }

const tabs = (active) => `
  <div class="tabs" role="tablist" aria-label="Sign-in method">
    <button role="tab" type="button" aria-selected="${active==='email'}" data-action="goStep" data-step="email">Email</button>
    <button role="tab" type="button" aria-selected="${active==='phone'}" data-action="goStep" data-step="phone">Phone</button>
  </div>`;

const alerts = () => `
  ${state.error ? `<div class="error" role="alert">${esc(state.error)}
    ${state.errorCode === 'EMAIL_NOT_VERIFIED'
      ? `<div><button class="link" type="button" data-action="resend">Send the confirmation link again</button></div>` : ''}
  </div>` : ''}
  ${state.notice ? `<div class="ok">${esc(state.notice)}</div>` : ''}`;

const passwordField = (id, auto, label) => `
  <label for="${id}">${label}</label>
  <div class="pw">
    <input id="${id}" type="${state.showPw ? 'text' : 'password'}" autocomplete="${auto}" required
           minlength="${auto === 'new-password' ? 10 : 1}" maxlength="128">
    <button type="button" data-action="togglePw" data-id="${id}" aria-label="${state.showPw ? 'Hide' : 'Show'} password">
      ${state.showPw ? 'Hide' : 'Show'}</button>
  </div>
  ${auto === 'new-password' ? '<div class="hint">At least 10 characters. Three or four unrelated words work well.</div>' : ''}`;

const devLinkCard = () => state.devLink ? `
  <div class="card">
    <strong>Development mode:</strong> no email service is configured, so here is the link that would have been sent.
    <a class="devlink" href="${esc(state.devLink)}">Open the link</a>
  </div>` : '';

const VIEWS = {
  email(){
    return `
      <h1>Sign in to Batoma</h1>
      <p class="sub">Share your travels, vote on stories and save your trips.</p>
      ${tabs('email')}
      <form data-submit="submitLogin" novalidate>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}">
        ${passwordField('password', 'current-password', 'Password')}
        <div class="row"><button class="link" type="button" data-action="goWithEmail" data-step="forgot">Forgot password?</button></div>
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goWithEmail" data-step="register">New here? Create an account</button>
      <p class="hint center">Own or manage buses? <a href="owner.html">Batoma for bus owners</a><br>
        Listed as a hotel, restaurant or agency? <a href="login.html?returnTo=business.html">Batoma for partners</a></p>`;
  },
  register(){
    return `
      <h1>Create your account</h1>
      <p class="sub">We'll email you a link to confirm your address.</p>
      <form data-submit="submitRegister" novalidate>
        <label for="name">Your name</label>
        <input id="name" autocomplete="name" required minlength="2" maxlength="60" value="${esc(state.name)}">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}">
        ${passwordField('password', 'new-password', 'Password')}
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Already have an account? Sign in</button>`;
  },
  sent(){
    return `
      <h1>Check your inbox</h1>
      <p class="sub">If <strong>${esc(state.email)}</strong> can be used, a link is on its way. It may take a minute, so check spam too.</p>
      ${devLinkCard()}
      ${alerts()}
      <button class="btn btn-ghost" type="button" data-action="resend" ${state.busy ? 'disabled' : ''}>Resend the link</button>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Back to sign in</button>`;
  },
  forgot(){
    return `
      <h1>Reset your password</h1>
      <p class="sub">Enter your email and we'll send you a reset link.</p>
      <form data-submit="submitForgot" novalidate>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" inputmode="email" required value="${esc(state.email)}">
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Back to sign in</button>`;
  },
  forgotSent(){
    return `
      <h1>Check your inbox</h1>
      <p class="sub">If an account uses <strong>${esc(state.email)}</strong>, a reset link is on its way. It expires in 1 hour.</p>
      ${devLinkCard()}
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Back to sign in</button>`;
  },
  reset(){
    return `
      <h1>Choose a new password</h1>
      <p class="sub">You'll be signed out on every other device.</p>
      <form data-submit="submitReset" novalidate>
        ${passwordField('password', 'new-password', 'New password')}
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save new password'}</button>
      </form>`;
  },
  working(){
    return `<h1>${esc(state.notice || 'One moment…')}</h1><div class="spinner" role="status" aria-label="Loading"></div>`;
  },
  linkFailed(){
    return `
      <h1>That link didn't work</h1>
      <div class="error" role="alert">${esc(state.error)}</div>
      <button class="btn" type="button" data-action="goStep" data-step="email">Back to sign in</button>`;
  },
  phone(){
    return `
      <h1>Sign in to Batoma</h1>
      <p class="sub">Enter your Nepali mobile number and we'll text you a code.</p>
      ${tabs('phone')}
      <form data-submit="submitPhone" novalidate>
        <label for="phone">Phone number</label>
        <input id="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="98XXXXXXXX" required value="${esc(state.phone)}">
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending…' : 'Send code'}</button>
      </form>`;
  },
  code(){
    return `
      <h1>Enter the code</h1>
      <p class="sub">We sent a 6-digit code to ${esc(state.phone)}.</p>
      ${state.devCode ? `<div class="card">Development mode: no SMS gateway is configured. Your code is
        <div class="devcode">${esc(state.devCode)}</div></div>` : ''}
      <form data-submit="submitCode" novalidate>
        <label for="code">6-digit code</label>
        <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required>
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="phone">Use a different number</button>`;
  },
  mfa(){
    return `
      <h1>Enter your authenticator code</h1>
      <p class="sub">This account uses an authenticator app. Enter the 6-digit code from Google Authenticator or Authy.</p>
      <form data-submit="submitMfa" novalidate>
        <label for="mfacode">6-digit code</label>
        <input id="mfacode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required>
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="recover">Lost your phone? Use a recovery code</button>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Use a different account</button>`;
  },
  recover(){
    return `
      <h1>Use a recovery code</h1>
      <p class="sub">Enter one of the ten codes you saved when you set up your authenticator. Each works once.</p>
      <form data-submit="submitRecover" novalidate>
        <label for="rcode">Recovery code</label>
        <input id="rcode" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="k7m2p-xq4hz" maxlength="20" required>
        ${alerts()}
        <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Sign in'}</button>
      </form>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="mfa">Use the authenticator instead</button>`;
  },
  recovered(){
    return `
      <h1>You are signed in</h1>
      <div class="${state.left <= 2 ? 'error' : 'ok'}" role="status">You have ${state.left} recovery ${state.left === 1 ? 'code' : 'codes'} left.
        ${state.left <= 2 ? 'Set up your authenticator again on your new phone, and make new codes, soon.' : ''}</div>
      <button class="btn" type="button" data-action="continueOn">Continue</button>`;
  },
  mfaRequired(){
    return `
      <h1>Set up your authenticator first</h1>
      <p class="sub">This account manages Batoma or a company's money, so it needs an authenticator app. Set it up once in the control panel or the bus owner portal, then you can sign in here too.</p>
      <a class="btn" href="admin.html">Open the control panel</a>
      <a class="btn btn-ghost" href="owner.html">Open the bus owner portal</a>
      <button class="btn btn-ghost" type="button" data-action="goStep" data-step="email">Use a different account</button>`;
  },
};

function togglePw(id){
  const val = $('#' + id)?.value || '';
  state.showPw = !state.showPw;
  const keep = { name: $('#name')?.value, email: $('#email')?.value };
  render();
  if(keep.name !== undefined && $('#name')) $('#name').value = keep.name;
  if(keep.email !== undefined && $('#email')) $('#email').value = keep.email;
  $('#' + id).value = val;
  $('#' + id).focus();
}

function busy(){ state.error = ''; state.errorCode = ''; state.notice = ''; state.busy = true; }

function fail(err, keep = {}){
  state.busy = false; state.error = err.message; state.errorCode = err.code || '';
  render();
  if(keep.email && $('#email')) $('#email').value = keep.email;
  if(keep.name && $('#name')) $('#name').value = keep.name;
}

function finish(data){
  // Accounts with control-panel roles sign in here too, after their authenticator code.
  if(data.mfaEnrolmentRequired){ go('mfaRequired'); return; }
  if(data.mfaRequired){ go('mfa', { challengeToken: data.challengeToken }); return; }
  save(data);
  location.replace(returnTo);
}

function save(data){
  localStorage.setItem('bato.auth', JSON.stringify({
    accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user,
  }));
}

function valid(){
  const form = $('#view form');
  if(form && !form.checkValidity()){
    const bad = form.querySelector(':invalid');
    const labelText = $(`label[for="${bad.id}"]`)?.textContent || 'This field';
    state.error = bad.type === 'email' ? 'Enter a valid email address.'
      : bad.id === 'password' && bad.minLength === 10 ? 'Use at least 10 characters for your password.'
      : `${labelText} is required.`;
    state.errorCode = '';
    const keep = { email: $('#email')?.value, name: $('#name')?.value };
    render();
    if(keep.email && $('#email')) $('#email').value = keep.email;
    if(keep.name && $('#name')) $('#name').value = keep.name;
    $('#' + bad.id)?.focus();
    return false;
  }
  return true;
}

async function submitLogin(e){
  e.preventDefault();
  if(!valid()) return;
  state.email = $('#email').value.trim();
  const password = $('#password').value;
  busy(); render(); $('#email').value = state.email;
  try{ finish(await api('/auth/email/login', { email: state.email, password })); }
  catch(err){ fail(err, { email: state.email }); }
}

async function submitRegister(e){
  e.preventDefault();
  if(!valid()) return;
  state.name = $('#name').value.trim();
  state.email = $('#email').value.trim();
  const password = $('#password').value;
  busy(); render();
  try{
    const data = await api('/auth/email/register', { name: state.name, email: state.email, password });
    go('sent', { devLink: data.devLink || '' });
  }catch(err){ state.busy = false; state.error = err.message; render(); $('#name').value = state.name; $('#email').value = state.email; }
}

async function resend(){
  state.busy = true;
  try{
    const data = await api('/auth/email/resend', { email: state.email || $('#email')?.value });
    go('sent', { devLink: data.devLink || '', notice: 'A new link is on its way.' });
  }catch(err){ state.busy = false; state.error = err.message; render(); }
}

async function submitForgot(e){
  e.preventDefault();
  if(!valid()) return;
  state.email = $('#email').value.trim();
  busy(); render();
  try{
    const data = await api('/auth/password/forgot', { email: state.email });
    go('forgotSent', { devLink: data.devLink || '' });
  }catch(err){ fail(err, { email: state.email }); }
}

async function submitReset(e){
  e.preventDefault();
  if(!valid()) return;
  busy(); render();
  try{
    const data = await api('/auth/password/reset', { token: state.resetToken, password: $('#password')?.value || '' });
    go('email', { notice: data.message });
  }catch(err){
    if(err.status === 400 && /link/i.test(err.message)){ go('linkFailed', { error: err.message }); return; }
    fail(err);
  }
}

async function submitMfa(e){
  e.preventDefault();
  const code = $('#mfacode').value.trim();
  if(!/^\d{6}$/.test(code)){
    state.error = 'Enter the 6 digits from your authenticator app.';
    render();
    $('#mfacode').focus();
    return;
  }
  busy(); render();
  try{
    finish(await api('/auth/mfa/verify', { challengeToken: state.challengeToken, code }));
  }catch(err){
    if(err.status === 401 && /expired/i.test(err.message)){
      go('email', { error: 'That took too long. Sign in again.' });
      return;
    }
    fail(err);
  }
}

async function submitRecover(e){
  e.preventDefault();
  const code = $('#rcode').value.trim();
  if(code.replace(/[^a-z0-9]/gi, '').length !== 10){
    state.error = 'A recovery code has 10 letters and numbers, like k7m2p-xq4hz.';
    render(); $('#rcode').focus(); return;
  }
  busy(); render();
  try{
    const data = await api('/auth/mfa/recover', { challengeToken: state.challengeToken, code });
    save(data);
    go('recovered', { left: data.recoveryCodesLeft });
  }catch(err){
    if(err.status === 401 && /expired/i.test(err.message)){ go('email', { error: 'That took too long. Sign in again.' }); return; }
    fail(err);
  }
}

async function submitPhone(e){
  e.preventDefault();
  state.phone = $('#phone').value.trim();
  busy(); render();
  try{
    const data = await api('/auth/otp/request', { phone: state.phone });
    go('code', { devCode: data.devCode || '' });
  }catch(err){
    if(err.status === 404) err.message = 'Phone sign-in is not available right now. Please use email.';
    fail(err); $('#phone').value = state.phone;
  }
}

async function submitCode(e){
  e.preventDefault();
  const code = $('#code').value.trim();
  busy(); render();
  try{ finish(await api('/auth/otp/verify', { phone: state.phone, code })); }
  catch(err){ fail(err); }
}


Actions.on({
  goStep: (el) => go(el.dataset.step),
  goWithEmail: (el) => go(el.dataset.step, { email: $('#email')?.value || state.email }),
  resend: () => resend(),
  togglePw: (el) => togglePw(el.dataset.id),
  continueOn: () => location.replace(returnTo),
});
// Submit handlers get (form, event); these functions take the event.
const onEvent = (fn) => (_form, ev) => fn(ev);
Actions.onSubmit(Object.fromEntries(Object.entries({ submitLogin, submitRegister, submitForgot, submitReset, submitMfa, submitRecover, submitPhone, submitCode })
  .map(([name, fn]) => [name, onEvent(fn)])));

/* Links from emails land here. Strip the token from the address bar and history straight away. */
(async function boot(){
  const verify = params.get('verify');
  const reset = params.get('reset');
  if(verify || reset) history.replaceState(null, '', location.pathname + (params.get('returnTo') ? `?returnTo=${encodeURIComponent(returnTo)}` : ''));

  if(verify){
    go('working', { notice: 'Confirming your email…' });
    try{ finish(await api('/auth/email/verify', { token: verify })); }
    catch(err){ go('linkFailed', { error: err.message }); }
    return;
  }
  if(reset){ go('reset', { resetToken: reset }); return; }
  // The "was it you?" email after a new sign-in links here.
  if(params.get('forgot')){ go('forgot'); return; }
  go(params.get('method') === 'phone' ? 'phone' : 'email');
})();
