const API = window.BATO_CONFIG?.api || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
try{ const t = localStorage.getItem('bato.theme'); if(t) document.documentElement.dataset.theme = t; }catch(_){}

const BUS_TYPE = {
  TOURIST_DELUXE: 'Tourist deluxe', SOFA_SEATER: 'Sofa seater', AC_DELUXE: 'AC deluxe', SLEEPER: 'Sleeper',
  MICRO_BUS: 'Micro bus', HIACE: 'Hiace', LOCAL: 'Local bus', MINI_BUS: 'Mini bus', OTHER: 'Bus',
};
const AMENITY = {
  AC: 'Air conditioning', WIFI: 'Wi-Fi', CHARGING: 'Phone charging', RECLINING_SEATS: 'Reclining seats', TOILET: 'Toilet',
  WATER: 'Drinking water', TV: 'TV', CCTV: 'CCTV', FIRST_AID: 'First aid kit', GPS_TRACKING: 'GPS tracking',
  LUGGAGE_RACK: 'Luggage rack', BLANKETS: 'Blankets',
};
const RATING_WORD = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];
const PARTS = [['cleanliness', 'Cleanliness'], ['driving', 'Safe driving'], ['punctuality', 'On time'], ['staff', 'Staff']];
const REASONS = [
  ['SPAM', 'Spam or advertising'], ['HARASSMENT', 'Abusive or hateful'], ['MISINFORMATION', 'False or misleading'],
  ['SEXUAL_CONTENT', 'Sexual content'], ['ILLEGAL', 'Illegal or dangerous'], ['OTHER', 'Something else'],
];

const state = {
  view: 'search', q: '', results: null, searching: false, error: '',
  bus: null, company: null, reviews: [], meta: null, loadingMore: false,
  auth: null, form: null, formError: '', formErrorCode: '', sending: false, done: '',
};

const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };
const stars = (n) => { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); };
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function sessionId(){
  let sid = localStorage.getItem('bato.sid');
  if(!sid){ sid = 'sid_' + Math.random().toString(36).slice(2, 14); localStorage.setItem('bato.sid', sid); }
  return sid;
}

/* ---------- scan tokens: proof of scanning a sticker, kept per bus or company until they expire ---------- */
function jwtExpiry(token){
  try{ return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }catch(_){ return 0; }
}
function scanTokens(){ try{ return JSON.parse(localStorage.getItem('bato.scans') || '{}'); }catch(_){ return {}; } }
function saveScan(key, token){
  const all = scanTokens();
  for(const k of Object.keys(all)) if(jwtExpiry(all[k]) < Date.now()) delete all[k];
  all[key] = token;
  try{ localStorage.setItem('bato.scans', JSON.stringify(all)); }catch(_){}
}
function dropScan(bus){
  const all = scanTokens();
  delete all[`bus:${bus.id}`]; delete all[`company:${bus.company.id}`];
  try{ localStorage.setItem('bato.scans', JSON.stringify(all)); }catch(_){}
}
function scanTokenFor(bus){
  const all = scanTokens();
  for(const key of [`bus:${bus.id}`, `company:${bus.company.id}`]){
    if(all[key] && jwtExpiry(all[key]) > Date.now() + 60_000) return all[key];
  }
  return null;
}

/* ---------- the traveller's session from login.html, refreshed the same way as index.html ---------- */
function loadAuth(){ try{ state.auth = JSON.parse(localStorage.getItem('bato.auth') || 'null'); }catch(_){ state.auth = null; } }
function tokenExpiresSoon(token){ return jwtExpiry(token) - Date.now() < 30_000; }
let refreshing = null;
function refreshSession(){
  if(refreshing) return refreshing;
  const run = async () => {
    const stored = JSON.parse(localStorage.getItem('bato.auth') || 'null');
    if(!stored?.refreshToken){ const e = new Error('signed out'); e.expired = true; throw e; }
    if(stored.accessToken !== state.auth?.accessToken && !tokenExpiresSoon(stored.accessToken)){ state.auth = stored; return stored; }
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });
    if(!res.ok){ const e = new Error('Could not refresh'); e.expired = res.status === 401; throw e; }
    const { data } = await res.json();
    state.auth = { ...stored, accessToken: data.accessToken, refreshToken: data.refreshToken };
    localStorage.setItem('bato.auth', JSON.stringify(state.auth));
    return state.auth;
  };
  refreshing = (navigator.locks ? navigator.locks.request('bato-refresh', run) : run()).finally(() => { refreshing = null; });
  return refreshing;
}
function sessionEnded(){ state.auth = null; localStorage.removeItem('bato.auth'); }

async function api(path, { method = 'GET', body, auth = false } = {}){
  const opts = { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined };
  let res;
  if(auth && state.auth){
    if(tokenExpiresSoon(state.auth.accessToken)){
      try{ await refreshSession(); }catch(err){ if(err.expired) sessionEnded(); }
    }
    const call = () => fetch(`${API}${path}`, state.auth
      ? { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${state.auth.accessToken}` } } : opts);
    res = await call();
    if(res.status === 401 && state.auth){
      try{ await refreshSession(); res = await call(); }catch(err){ if(err.expired){ sessionEnded(); res = await call(); } }
    }
  } else {
    res = await fetch(`${API}${path}`, opts);
  }
  const json = await res.json().catch(() => ({}));
  if(!res.ok){
    const err = new Error(json?.message || 'Something went wrong. Please try again.');
    err.code = json?.code; err.status = res.status;
    throw err;
  }
  return json.data;
}

/* ---------- routing ---------- */
function setUrl(query, push){
  const url = `bus.html${query ? `?${query}` : ''}`;
  if(push) history.pushState(null, '', url); else history.replaceState(null, '', url);
}

async function route(){
  const params = new URLSearchParams(location.search);
  const hashBus = (location.hash.match(/^#bus-([\w-]{8,64})$/) || [])[1];
  loadAuth();
  if(params.get('code')) return scan(params.get('code'));
  if(params.get('id') || hashBus) return openBus(params.get('id') || hashBus, false);
  if(params.get('company')) return openCompany(params.get('company'), false);
  state.view = 'search';
  state.q = params.get('q') || '';
  render();
  if(state.q) runSearch();
}
window.addEventListener('popstate', route);

function render(){
  $('#view').innerHTML = VIEWS[state.view]();
  if(state.view === 'bus') renderForm();
}

/* ---------- views ---------- */
const VIEWS = {
  loading: () => `<div class="spinner" role="status" aria-label="Loading"></div>`,

  error: () => `
    <div class="card" style="margin-top:22px">
      <h1 style="font-size:23px">We couldn't open that</h1>
      <div class="error" role="alert">${esc(state.error)}</div>
      <button class="btn btn-block" style="margin-top:14px" data-action="goSearch">Search for a bus</button>
    </div>`,

  search: () => `
    <section class="hero">
      <h1>Rate your bus</h1>
      <p>Find a bus by its registration number, its name or the company. Scanning the QR code inside the bus brings you straight to it.</p>
      <form class="search" role="search" data-submit="submitSearch">
        <label for="q" class="sr-only">Registration number, bus name or company</label>
        <input id="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="e.g. BA 1 KHA 2345 or Himalayan" value="${esc(state.q)}">
        <button class="btn" type="submit">Search</button>
      </form>
    </section>
    <div class="results">
      ${state.searching ? '<div class="spinner" role="status" aria-label="Searching"></div>'
        : state.error ? `<div class="error" role="alert">${esc(state.error)}</div>`
        : state.results === null ? ''
        : !state.results.length ? `<div class="empty">No public buses match “${esc(state.q)}”. Check the number on the plate.
            If the company has only just joined Batoma, its buses appear once they are verified.</div>`
        : state.results.map(resultRow).join('')}
    </div>
    <p class="owner-cta">Run a bus or a bus company? <a href="owner.html">Register your buses on Batoma</a></p>`,

  bus: () => {
    const b = state.bus;
    const r = b.rating;
    const max = Math.max(1, ...r.distribution.map((d) => d.count));
    return `
      <button class="back" data-action="goSearch">← Find another bus</button>
      <article class="card bus-head">
        ${b.photoUrl ? `<img class="bus-photo" src="${esc(b.photoUrl)}" alt="Photo of ${esc(b.label || b.registrationNo)}">` : ''}
        <span class="plate" aria-label="Registration number">${esc(b.registrationNo)}</span>
        <h1>${esc(b.label || b.registrationNo)}</h1>
        <div class="company">
          <button class="link" style="padding:0;font-size:inherit" data-action="openCompany" data-slug="${esc(b.company.slug)}">${esc(b.company.name)}</button>
          <span class="verified">✓ Verified by Batoma</span>
        </div>
        <div class="facts">
          ${b.route ? `<span>🛣 ${esc(b.route.name)}</span>` : ''}
          ${b.busType ? `<span>${esc(BUS_TYPE[b.busType] || b.busType)}</span>` : ''}
          ${b.seatCount ? `<span>${b.seatCount} seats</span>` : ''}
          ${b.make ? `<span>${esc([b.make, b.model, b.year].filter(Boolean).join(' '))}</span>` : ''}
        </div>
        ${b.amenities?.length ? `<div class="chips">${b.amenities.map((a) => `<span class="chip">${esc(AMENITY[a] || a)}</span>`).join('')}</div>` : ''}
        ${b.status !== 'ACTIVE' ? `<div class="status-note">${b.status === 'IN_MAINTENANCE' ? 'This bus is in for maintenance at the moment.' : 'This bus is not running at the moment.'}</div>` : ''}
      </article>

      <section class="card" aria-labelledby="scoreHead">
        <h2 id="scoreHead" class="sr-only">Passenger rating</h2>
        ${r.reviews ? `
          <div class="score">
            <div>
              <div class="big">${r.average.toFixed(1)}</div>
              <div class="stars" aria-label="${r.average} out of 5">${stars(r.average)}</div>
              <div class="hint">${r.reviews} review${r.reviews === 1 ? '' : 's'}${r.satisfiedPercent != null ? ` · ${r.satisfiedPercent}% happy` : ''}</div>
            </div>
            <div class="dist" aria-label="Ratings by stars">
              ${r.distribution.map((d) => `
                <div class="dist-row"><span>${d.stars}★</span><div class="bar"><span style="width:${Math.round((d.count / max) * 100)}%"></span></div><span>${d.count}</span></div>`).join('')}
            </div>
          </div>
          <div class="parts">
            ${PARTS.map(([k, label]) => r.parts[k] != null ? `<div class="part"><b>${r.parts[k].toFixed(1)}</b>${label}</div>` : '').join('')}
          </div>` : `<p style="margin:0">No reviews yet. Be the first to say how this bus was.</p>`}
      </section>

      <section class="card" id="review" aria-labelledby="reviewHead">
        <h2 id="reviewHead" style="font-size:21px">How was your ride?</h2>
        <div id="reviewBox"></div>
      </section>

      <div class="sec"><h2>Passenger reviews</h2><span>Newest first</span></div>
      <section class="card" style="margin-top:8px;padding-top:4px;padding-bottom:4px">
        ${state.reviews.length ? state.reviews.map(reviewItem).join('') : '<div class="empty">No written reviews yet.</div>'}
      </section>
      ${state.meta && state.meta.page < state.meta.pages ? `
        <button class="btn btn-ghost btn-block" style="margin-top:12px" data-action="loadMore" ${state.loadingMore ? 'disabled' : ''}>
          ${state.loadingMore ? 'Loading…' : 'Show more reviews'}</button>` : ''}`;
  },

  company: () => {
    const c = state.company;
    return `
      <button class="back" data-action="goSearch">← Find another bus</button>
      <article class="card">
        <h1 style="font-size:27px">${esc(c.name)}</h1>
        <div class="company"><span class="verified">✓ Verified by Batoma</span></div>
        ${c.description ? `<p style="margin:10px 0 0">${esc(c.description)}</p>` : ''}
        <div class="facts">
          <span>${c.busCount} bus${c.busCount === 1 ? '' : 'es'}</span>
          ${c.rating.reviews ? `<span><span class="stars" style="font-size:15px">${stars(c.rating.average)}</span> ${c.rating.average.toFixed(1)} from ${c.rating.reviews} reviews</span>` : ''}
          ${c.address ? `<span>📍 ${esc(c.address)}</span>` : ''}
        </div>
      </article>
      <div class="sec"><h2>Which bus are you on?</h2><span>Check the plate</span></div>
      <div class="results">${c.buses.length ? c.buses.map(resultRow).join('') : '<div class="empty">No buses listed yet.</div>'}</div>`;
  },
};

function resultRow(b){
  return `
    <button class="result" data-action="openBus" data-id="${esc(b.id)}">
      ${b.photoUrl ? `<img class="thumb" src="${esc(b.photoUrl)}" alt="">` : '<span class="thumb" aria-hidden="true">🚌</span>'}
      <span style="flex:1;min-width:0">
        <span class="plate">${esc(b.registrationNo)}</span>
        <h3>${esc(b.label || b.registrationNo)}</h3>
        <small>${esc([b.company, b.route, BUS_TYPE[b.busType]].filter(Boolean).join(' · '))}</small>
        <small>${b.rating.reviews ? `<span class="stars" style="font-size:14px">${stars(b.rating.average)}</span> ${b.rating.average.toFixed(1)} · ${b.rating.reviews} review${b.rating.reviews === 1 ? '' : 's'}` : 'No reviews yet'}</small>
      </span>
      <span aria-hidden="true" style="color:var(--text-dim);font-size:20px">›</span>
    </button>`;
}

function reviewItem(r){
  const parts = PARTS.filter(([k]) => r[k]).map(([k, label]) => `${label} ${r[k]}`).join(' · ');
  const reported = reportedIds().includes(r.id);
  return `
    <article class="review">
      <div class="rv-head">
        <span class="stars" aria-label="${r.overall} out of 5">${stars(r.overall)}</span>
        <span class="rv-who ${r.verifiedRide ? 'v' : ''}">${r.verifiedRide ? '✓ Scanned on board' : 'Passenger'}</span>
        <time datetime="${esc(r.createdAt)}">${fmtDay(r.createdAt)}</time>
      </div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      ${parts ? `<div class="rv-parts">${esc(parts)}${r.tripDate ? ` · travelled ${fmtDay(r.tripDate)}` : ''}</div>` : ''}
      ${r.ownerReply ? `<div class="reply"><b>Reply from ${esc(state.bus.company.name)}</b><p>${esc(r.ownerReply)}</p></div>` : ''}
      <div class="rv-foot">
        <button class="link" data-action="openReport" data-id="${esc(r.id)}" ${reported ? 'disabled' : ''}>${reported ? 'Reported' : 'Report'}</button>
      </div>
    </article>`;
}

/* ---------- review form: rendered on its own so typing survives star taps ---------- */
function freshForm(){ return { overall: 0, cleanliness: 0, driving: 0, punctuality: 0, staff: 0, comment: '', suggestion: '', tripDate: '' }; }

function starGroup(field, value, size){
  const label = field === 'overall' ? 'Overall rating' : PARTS.find(([k]) => k === field)[1];
  return `<div class="rate" role="radiogroup" aria-label="${label}">
    ${[1, 2, 3, 4, 5].map((n) => `
      <button type="button" class="star-btn ${n <= value ? 'on' : ''}" role="radio" aria-checked="${n === value}"
        aria-label="${n} star${n === 1 ? '' : 's'}" id="star-${field}-${n}" data-action="setStar" data-field="${field}" data-n="${n}"
        ${size ? `style="${size}"` : ''}>★</button>`).join('')}
  </div>`;
}

function renderForm(){
  const box = $('#reviewBox');
  if(!box) return;
  const b = state.bus;
  const f = state.form;
  const token = scanTokenFor(b);
  const signedIn = !!state.auth;

  if(state.done){
    box.innerHTML = `<div class="ok" role="status">${esc(state.done)}</div>`;
    return;
  }
  if(!token && !signedIn){
    const back = encodeURIComponent(`bus.html#bus-${b.id}`);
    box.innerHTML = `
      <div class="gate">
        <p>To keep reviews honest, Batoma asks for one of these:</p>
        <p><strong>On the bus?</strong> Scan the QR code sticker inside with your phone camera. No account needed.</p>
        <p><strong>Travelled already?</strong> Sign in and leave your review.</p>
        <a class="btn btn-brand btn-block" href="login.html?returnTo=${back}">Sign in to review</a>
        ${state.formError ? `<div class="error" role="alert">${esc(state.formError)}</div>` : ''}
      </div>`;
    return;
  }

  box.innerHTML = `
    <div style="margin:8px 0 4px">
      ${token ? '<span class="badge">✓ You scanned this bus’s QR code</span>'
        : `<span class="hint">Reviewing as ${esc(state.auth.user?.name || 'you')}. Your name is never shown to the company.</span>`}
    </div>
    <form data-submit="submitReview" novalidate>
      <label id="overallLabel">Overall <span aria-hidden="true" style="color:var(--rhodo)">*</span></label>
      ${starGroup('overall', f.overall)}
      <div class="rate-label" aria-live="polite">${RATING_WORD[f.overall] || 'Tap a star'}</div>

      <label>Rate the details <span style="font-weight:500">(optional)</span></label>
      <div>
        ${PARTS.map(([k, label]) => `<div class="sub-rate"><span>${label}</span>${starGroup(k, f[k], 'width:42px;height:42px;font-size:22px')}</div>`).join('')}
      </div>

      <label for="comment">Your review <span style="font-weight:500">(shown publicly)</span></label>
      <textarea id="comment" maxlength="1000" placeholder="What went well, and what didn't?" data-input="formField" data-field="comment">${esc(f.comment)}</textarea>

      <label for="suggestion">A suggestion for the company <span style="font-weight:500">(only they see this)</span></label>
      <textarea id="suggestion" maxlength="1000" style="min-height:80px" placeholder="e.g. Please add a stop every two hours" data-input="formField" data-field="suggestion">${esc(f.suggestion)}</textarea>

      <label for="tripDate">When did you travel? <span style="font-weight:500">(optional)</span></label>
      <input id="tripDate" type="date" max="${todayIso()}" value="${esc(f.tripDate)}" data-change="formField" data-field="tripDate">

      ${state.formError ? `<div class="error" role="alert">${esc(state.formError)}</div>` : ''}
      <button class="btn btn-block" style="margin-top:18px" type="submit" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Send review'}</button>
      <p class="hint">One review per bus a day. Reviews that break Batoma's rules are removed.</p>
    </form>`;
}

function setStar(field, n){
  state.form[field] = state.form[field] === n && field !== 'overall' ? 0 : n;
  if(field === 'overall') state.formError = '';
  renderForm();
  document.getElementById(`star-${field}-${n}`)?.focus();
}

async function submitReview(e){
  e.preventDefault();
  const b = state.bus;
  const f = state.form;
  if(!f.overall){ state.formError = 'Choose an overall rating from 1 to 5 stars.'; renderForm(); $('#star-overall-1')?.focus(); return; }
  state.sending = true; state.formError = ''; renderForm();
  const body = { overall: f.overall, sessionId: sessionId() };
  for(const [k] of PARTS) if(f[k]) body[k] = f[k];
  if(f.comment.trim()) body.comment = f.comment.trim();
  if(f.suggestion.trim()) body.suggestion = f.suggestion.trim();
  if(f.tripDate) body.tripDate = f.tripDate;
  const token = scanTokenFor(b);
  if(token) body.scanToken = token;
  try{
    const res = await api(`/buses/${b.id}/reviews`, { method: 'POST', body, auth: true });
    state.sending = false;
    state.form = freshForm();
    state.done = res.message;
    await openBus(b.id, false, true);
    toast('Thank you for your review');
    document.getElementById('review')?.scrollIntoView({ block: 'start' });
  }catch(err){
    state.sending = false;
    if(err.code === 'SCAN_EXPIRED') dropScan(b);
    state.formError = err.message;
    renderForm();
  }
}

/* ---------- actions ---------- */
function goSearch(){ state.error = ''; state.view = 'search'; setUrl(state.q ? `q=${encodeURIComponent(state.q)}` : '', true); render(); $('#q')?.focus(); }

function submitSearch(e){
  e.preventDefault();
  state.q = $('#q').value.trim();
  setUrl(state.q ? `q=${encodeURIComponent(state.q)}` : '', false);
  runSearch();
}

async function runSearch(){
  state.error = '';
  if(state.q.length < 2){ state.results = null; state.error = 'Type at least 2 characters.'; render(); return; }
  state.searching = true; render();
  try{ state.results = await api(`/buses/search?q=${encodeURIComponent(state.q)}`); }
  catch(err){ state.results = null; state.error = err.status ? err.message : 'Batoma is not reachable right now. Check your connection and try again.'; }
  state.searching = false;
  render();
  $('#q')?.focus();
}

async function scan(code){
  state.view = 'loading'; render();
  try{
    // A bus's sticker opens its magazine first now; older stickers that still point here are
    // sent on. Peeking does not count the scan: the magazine counts it when it opens.
    const kind = await api(`/buses/scan/${encodeURIComponent(code)}`, { method: 'POST', body: { peek: true } });
    if(kind?.kind && kind.kind !== 'COMPANY'){
      location.replace(`/b/${encodeURIComponent(code)}`);
      return;
    }
    const data = await api(`/buses/scan/${encodeURIComponent(code)}`, { method: 'POST', body: { sessionId: sessionId() } });
    // The address bar stops carrying the sticker code, so a copied link can't hand out "scanned on board".
    if(data.kind === 'COMPANY'){
      saveScan(`company:${data.company.id}`, data.scanToken);
      setUrl(`company=${encodeURIComponent(data.company.slug)}`, false);
      state.company = data.company; state.view = 'company'; render();
      return;
    }
    saveScan(`bus:${data.bus.id}`, data.scanToken);
    setUrl(`id=${data.bus.id}`, false);
    showBus(data.bus);
  }catch(err){
    setUrl('', false);
    state.error = err.status ? err.message : 'Batoma is not reachable right now. Check your connection and try again.';
    state.view = 'error'; render();
  }
}

function showBus(bus, keepDone){
  const changed = state.bus?.id !== bus.id;
  state.bus = bus;
  state.reviews = bus.reviews.items;
  state.meta = bus.reviews.meta;
  if(changed || !state.form) state.form = freshForm();
  if(!keepDone){ state.done = ''; state.formError = ''; }
  state.view = 'bus';
  render();
  if(location.hash === '#review') document.getElementById('review')?.scrollIntoView();
}

async function openBus(id, push, keepDone){
  if(push) setUrl(`id=${encodeURIComponent(id)}`, true);
  else if(location.hash.startsWith('#bus-')) setUrl(`id=${encodeURIComponent(id)}`, false);
  if(!keepDone){ state.view = 'loading'; render(); }
  try{
    showBus(await api(`/buses/${encodeURIComponent(id)}`), keepDone);
    if(!keepDone) window.scrollTo(0, 0);
  }catch(err){
    state.error = err.status ? err.message : 'Batoma is not reachable right now. Check your connection and try again.';
    state.view = 'error'; render();
  }
}

async function openCompany(slug, push){
  if(push) setUrl(`company=${encodeURIComponent(slug)}`, true);
  state.view = 'loading'; render();
  try{
    state.company = await api(`/buses/companies/${encodeURIComponent(slug)}`);
    state.view = 'company'; render(); window.scrollTo(0, 0);
  }catch(err){
    state.error = err.status ? err.message : 'Batoma is not reachable right now.';
    state.view = 'error'; render();
  }
}

async function loadMore(){
  state.loadingMore = true; render();
  try{
    const page = await api(`/buses/${state.bus.id}/reviews?page=${state.meta.page + 1}`);
    state.reviews = state.reviews.concat(page.items);
    state.meta = page.meta;
  }catch(err){ toast(err.message); }
  state.loadingMore = false; render();
}

/* ---------- reporting a review ---------- */
function reportedIds(){ try{ return JSON.parse(localStorage.getItem('bato.reportedBusReviews') || '[]'); }catch(_){ return []; } }

function openReport(id){
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `
    <form class="sheet" role="dialog" aria-modal="true" aria-labelledby="rpTitle" novalidate>
      <h2 id="rpTitle" style="font-size:21px">Report this review</h2>
      <p class="hint" style="margin:4px 0 8px">A Batoma moderator will look at it. The writer isn't told who reported it.</p>
      <fieldset style="border:0;margin:0;padding:0">
        <legend class="sr-only">Reason</legend>
        ${REASONS.map(([v, l]) => `<label class="reason"><input type="radio" name="reason" value="${v}"> ${l}</label>`).join('')}
      </fieldset>
      <label for="rpDetail">Anything to add? <span style="font-weight:500">(optional)</span></label>
      <textarea id="rpDetail" maxlength="1000" style="min-height:80px"></textarea>
      <div class="error" role="alert" hidden></div>
      <div class="row-btns">
        <button class="btn" type="submit">Send report</button>
        <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
      </div>
    </form>`;
  const returnFocus = document.activeElement;
  const close = () => { back.remove(); returnFocus?.focus?.(); };
  back.addEventListener('click', (e) => { if(e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
  back.querySelector('[data-cancel]').onclick = close;
  back.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const reason = back.querySelector('input[name="reason"]:checked')?.value;
    const box = back.querySelector('.error');
    if(!reason){ box.textContent = 'Choose a reason.'; box.hidden = false; return; }
    const submit = back.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Sending…';
    try{
      await api('/moderation/report', {
        method: 'POST', auth: true,
        body: { targetType: 'BUS_REVIEW', targetId: id, reason, detail: back.querySelector('#rpDetail').value.trim() || undefined, sessionId: sessionId() },
      });
      const ids = reportedIds(); ids.push(id);
      localStorage.setItem('bato.reportedBusReviews', JSON.stringify(ids.slice(-200)));
      close(); render(); toast('Thanks. A moderator will take a look.');
    }catch(err){
      box.textContent = err.message; box.hidden = false; submit.disabled = false; submit.textContent = 'Send report';
    }
  };
  document.body.appendChild(back);
  back.querySelector('input[name="reason"]').focus();
}

/* ---------- what the markup may ask for (see js/actions.js) ---------- */
Actions.on({
  goSearch: () => goSearch(),
  openCompany: (el) => openCompany(el.dataset.slug, true),
  openBus: (el) => openBus(el.dataset.id, true),
  loadMore: () => loadMore(),
  openReport: (el) => openReport(el.dataset.id),
  setStar: (el) => setStar(el.dataset.field, Number(el.dataset.n)),
});
Actions.onSubmit({
  submitSearch: (el, ev) => submitSearch(ev),
  submitReview: (el, ev) => submitReview(ev),
});
Actions.onInput({ formField: (el) => { state.form[el.dataset.field] = el.value; } });
Actions.onChange({ formField: (el) => { state.form[el.dataset.field] = el.value; } });

route();
