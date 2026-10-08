/* Creators: the directory, public profiles and journeys, and a creator's own panel (creator.html).
   Classic script; markup asks for handlers through web/js/actions.js. */
const API = window.BATO_CONFIG?.api || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
try{ const t = localStorage.getItem('bato.theme'); if(t) document.documentElement.dataset.theme = t; }catch(_){}

const npr = (n) => n == null ? '—' : `NPR ${Number(n).toLocaleString('en-IN')}`;
const fmtDay = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const state = {
  view: 'loading', auth: null, error: '',
  creators: [], profile: null, journey: null, dash: null, ad: null,
  editing: null, busy: false, formError: '',
};

const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600); };

/* ---------- session (shared with the traveller app) ---------- */
function jwtExpiry(token){ try{ return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }catch(_){ return 0; } }
const expiresSoon = (t) => jwtExpiry(t) - Date.now() < 30_000;
function loadAuth(){ try{ state.auth = JSON.parse(localStorage.getItem('bato.auth') || 'null'); }catch(_){ state.auth = null; } }
let refreshing = null;
function refreshSession(){
  if(refreshing) return refreshing;
  const run = async () => {
    const stored = JSON.parse(localStorage.getItem('bato.auth') || 'null');
    if(!stored?.refreshToken){ const e = new Error('signed out'); e.expired = true; throw e; }
    if(stored.accessToken !== state.auth?.accessToken && !expiresSoon(stored.accessToken)){ state.auth = stored; return stored; }
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
function signedOut(){ state.auth = null; localStorage.removeItem('bato.auth'); }

async function api(path, { method = 'GET', body, auth = false } = {}){
  const opts = { method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined };
  let res;
  if(auth && state.auth){
    if(expiresSoon(state.auth.accessToken)){ try{ await refreshSession(); }catch(err){ if(err.expired) signedOut(); } }
    const call = () => fetch(`${API}${path}`, state.auth
      ? { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${state.auth.accessToken}` } } : opts);
    res = await call();
    if(res.status === 401 && state.auth){
      try{ await refreshSession(); res = await call(); }catch(err){ if(err.expired){ signedOut(); res = await call(); } }
    }
  }else{
    res = await fetch(`${API}${path}`, opts);
  }
  const json = await res.json().catch(() => ({}));
  if(!res.ok){ const e = new Error(json?.message || 'Something went wrong.'); e.status = res.status; e.code = json?.code; throw e; }
  return json.data;
}

async function loadAd(){
  try{
    const ads = await api('/ads?placement=CREATOR_PROFILE&limit=1');
    state.ad = ads[0] || null;
  }catch(_){ state.ad = null; }
}

function adBlock(){
  const ad = state.ad;
  if(!ad) return '';
  const external = ad.linkType === 'EXTERNAL' && /^https:\/\//i.test(ad.externalUrl || '');
  const inner = `
    ${ad.imageUrl ? `<img src="${esc(ad.imageUrl)}" alt="">` : ''}
    <span class="ad-copy"><span class="from">${esc(ad.advertiserName)}</span>
      <h3>${esc(ad.title)}</h3>${ad.tagline ? `<div class="muted small">${esc(ad.tagline)}</div>` : ''}</span>`;
  fetch(`${API}/ads/impressions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ad.id] }), keepalive: true,
  }).catch(() => {});
  return `<aside class="ad"><div class="ad-rule"><span>Sponsored</span></div>
    ${external
      ? `<a class="ad-body" href="${esc(ad.externalUrl)}" target="_blank" rel="sponsored noopener noreferrer" data-action="adClicked" data-id="${esc(ad.id)}">${inner}</a>`
      : `<span class="ad-body">${inner}</span>`}</aside>`;
}
function adClicked(id){ fetch(`${API}/ads/${encodeURIComponent(id)}/click`, { method: 'POST', keepalive: true }).catch(() => {}); }

/* ---------- routing ---------- */
function setUrl(query, push){
  const url = `creator.html${query ? `?${query}` : ''}`;
  if(push) history.pushState(null, '', url); else history.replaceState(null, '', url);
}

async function route(){
  loadAuth();
  const p = new URLSearchParams(location.search);
  state.error = '';
  if(p.get('panel')) return openPanel();
  if(p.get('handle') && p.get('journey')) return openJourney(p.get('handle'), p.get('journey'));
  if(p.get('handle')) return openProfile(p.get('handle'));
  return openDirectory();
}
window.addEventListener('popstate', route);
const render = () => { $('#view').innerHTML = VIEWS[state.view](); };

const VIEWS = {
  loading: () => '<div class="spinner" role="status" aria-label="Loading"></div>',
  error: () => `<div class="card"><h1 style="font-size:22px">Not found</h1>
    <div class="error" role="alert">${esc(state.error)}</div>
    <button class="btn btn-block" style="margin-top:14px" data-action="openDirectory">See all creators</button></div>`,

  directory: () => `
    <div class="sec" style="margin-top:22px"><h2 style="font-size:27px">Creators on Batoma</h2></div>
    <p class="muted" style="margin-top:0">Travellers who tell the whole story: the road they took, how many days it ran to,
      what it actually cost and what was worth carrying. Everything Instagram leaves out.</p>
    ${adBlock()}
    ${state.creators.length ? `<div class="grid">${state.creators.map(creatorTile).join('')}</div>`
      : '<div class="empty">No creators yet. Batoma is approving the first ones now.</div>'}
    <div class="card" style="margin-top:22px">
      <h2 style="font-size:19px">Want your own creator profile?</h2>
      <p class="muted">Publish your adventures on Batoma, build a profile around your journeys, and let readers follow you.
        A Batoma admin checks each application.</p>
      <a class="btn btn-brand" href="creator.html?panel=1">Apply for creator access</a>
    </div>`,

  profile: () => {
    const c = state.profile;
    return `
      <button class="back" data-action="openDirectory">← All creators</button>
      ${c.coverUrl ? `<img class="cover" src="${esc(c.coverUrl)}" alt="">` : '<div class="cover"></div>'}
      <div class="who">
        ${c.avatarUrl ? `<img class="avatar" src="${esc(c.avatarUrl)}" alt="">` : `<div class="avatar">${esc(initials(c.displayName))}</div>`}
        <div style="flex:1;min-width:0;padding-bottom:6px">
          <h1>${esc(c.displayName)}</h1>
          <div class="handle">@${esc(c.handle)}${c.isFeatured ? ' · <span class="pill good">Featured</span>' : ''}</div>
        </div>
      </div>
      ${c.headline ? `<p style="font-size:17px;margin:12px 0 0">${esc(c.headline)}</p>` : ''}
      ${c.bio ? `<p class="muted" style="margin-top:6px">${esc(c.bio)}</p>` : ''}
      <div class="chips">
        ${c.homeBase ? `<span class="chip">📍 ${esc(c.homeBase)}</span>` : ''}
        ${(c.specialities || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}
        ${(c.languages || []).map((s) => `<span class="chip">🗣 ${esc(s)}</span>`).join('')}
        ${c.websiteUrl ? `<a class="chip" href="${esc(c.websiteUrl)}" target="_blank" rel="noopener nofollow">Website ↗</a>` : ''}
        ${c.instagram ? `<span class="chip">Instagram @${esc(c.instagram.replace(/^@/, ''))}</span>` : ''}
      </div>
      <div class="stats">
        <div class="stat"><b>${c.stats.journeys}</b><span>Journeys</span></div>
        <div class="stat"><b>${c.stats.posts}</b><span>Adventures</span></div>
        <div class="stat"><b>${c.stats.upvotes}</b><span>Upvotes</span></div>
        <div class="stat"><b>${c.stats.followers}</b><span>Followers</span></div>
      </div>
      <div class="row">
        ${c.isMe
          ? `<a class="btn btn-brand" href="creator.html?panel=1">Open my creator panel</a>`
          : state.auth
            ? `<button class="btn ${c.isFollowing ? 'btn-ghost' : 'btn-brand'}" data-action="toggleFollow">${c.isFollowing ? 'Following ✓' : 'Follow'}</button>`
            : `<a class="btn btn-brand" href="login.html?returnTo=${encodeURIComponent('creator.html')}">Sign in to follow</a>`}
      </div>
      ${adBlock()}
      ${c.journeys.length ? `
        <div class="sec"><h2>Journeys</h2><span class="muted small">The whole trip, in order</span></div>
        <div class="grid">${c.journeys.map((j) => journeyTile(j, c.handle)).join('')}</div>` : ''}
      ${c.pins.length ? `
        <div class="sec"><h2>Where they've been</h2></div>
        <div class="chips">${c.pins.map((p) => `<span class="chip">📍 ${esc(p.locationName || p.title)}</span>`).join('')}</div>` : ''}
      <div class="sec"><h2>Adventures</h2><span class="muted small">${plural(c.posts.length, 'post')}</span></div>
      ${c.posts.length ? `<div class="grid">${c.posts.map(postTile).join('')}</div>`
        : '<div class="empty">Nothing published yet.</div>'}`;
  },

  journey: () => {
    const j = state.journey;
    const costs = [['Transport', j.transportNpr], ['Stay', j.stayNpr], ['Food', j.foodNpr], ['Permits', j.permitsNpr], ['Other', j.otherNpr]]
      .filter(([, v]) => v != null);
    return `
      <button class="back" data-action="openProfile" data-handle="${esc(j.creator.handle)}">← ${esc(j.creator.displayName)}</button>
      ${j.coverImageUrl ? `<img class="cover" src="${esc(j.coverImageUrl)}" alt="">` : ''}
      <h1 style="font-size:28px;margin-top:16px">${esc(j.title)}</h1>
      <div class="chips">
        ${j.route ? `<span class="chip">🚌 ${esc(j.route.name)}</span>` : ''}
        ${j.destination ? `<span class="chip">📍 ${esc(j.destination.name)}</span>` : ''}
        ${j.dayCount ? `<span class="chip">${plural(j.dayCount, 'day')}</span>` : ''}
        ${j.startedOn ? `<span class="chip">${esc(fmtDay(j.startedOn))}</span>` : ''}
      </div>
      ${j.summary ? `<p style="font-size:17px;margin-top:12px">${esc(j.summary)}</p>` : ''}
      ${costs.length ? `
        <div class="sec"><h2>What it cost</h2><span class="muted small">Total ${esc(npr(j.totalCostNpr))}</span></div>
        <div class="cost">${costs.map(([label, v]) => `<div><b>${esc(npr(v))}</b>${label}</div>`).join('')}</div>` : ''}
      ${j.gear?.length ? `
        <div class="sec"><h2>What they carried</h2></div>
        <div class="chips">${j.gear.map((g) => `<span class="chip">🎒 ${esc(g)}</span>`).join('')}</div>` : ''}
      ${j.tips ? `<div class="card"><h2 style="font-size:18px">Tips</h2><p style="white-space:pre-wrap;margin:6px 0 0">${esc(j.tips)}</p></div>` : ''}
      ${adBlock()}
      <div class="sec"><h2>The journey</h2><span class="muted small">${plural(j.entries.length, 'stop')}</span></div>
      ${j.entries.map((e) => `
        <article class="entry">
          ${e.dayNumber ? `<div class="day">Day ${e.dayNumber}</div>` : ''}
          <h3>${esc(e.post.title)}</h3>
          ${e.post.locationName ? `<div class="muted small">📍 ${esc(e.post.locationName)}</div>` : ''}
          ${e.note ? `<p class="muted" style="margin:6px 0 0">${esc(e.note)}</p>` : ''}
          <p style="white-space:pre-wrap">${esc(e.post.body)}</p>
          ${e.post.photos.length ? `<div class="gallery">${e.post.photos.map((p) => `<img src="${esc(p.url)}" alt="${esc(p.caption || '')}" loading="lazy">`).join('')}</div>` : ''}
        </article>`).join('')}`;
  },

  panel: () => panelView(),
};

function creatorTile(c){
  return `
    <a class="tile" href="creator.html?handle=${encodeURIComponent(c.handle)}" data-action="openProfile" data-handle="${esc(c.handle)}">
      ${c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="">` : ''}
      <div class="body">
        <h3>${esc(c.displayName)}</h3>
        <div class="muted small">@${esc(c.handle)}${c.homeBase ? ` · ${esc(c.homeBase)}` : ''}</div>
        ${c.headline ? `<p class="small" style="margin:6px 0 0">${esc(c.headline)}</p>` : ''}
        <div class="muted small" style="margin-top:6px">${plural(c.journeys, 'journey')} · ${plural(c.posts, 'adventure')}</div>
      </div>
    </a>`;
}

function journeyTile(j, handle){
  return `
    <a class="tile" href="creator.html?handle=${encodeURIComponent(handle)}&journey=${encodeURIComponent(j.slug)}"
       data-action="openJourney" data-handle="${esc(handle)}" data-slug="${esc(j.slug)}">
      ${j.coverImageUrl ? `<img src="${esc(j.coverImageUrl)}" alt="">` : ''}
      <div class="body">
        <h3>${esc(j.title)}</h3>
        <div class="muted small">${[j.route?.name, j.dayCount ? plural(j.dayCount, 'day') : '', j.totalCostNpr ? npr(j.totalCostNpr) : '']
          .filter(Boolean).map(esc).join(' · ')}</div>
        ${j.summary ? `<p class="small" style="margin:6px 0 0">${esc(j.summary.slice(0, 110))}</p>` : ''}
      </div>
    </a>`;
}

function postTile(p){
  return `
    <article class="tile" style="cursor:default">
      ${p.coverImageUrl || p.photos?.[0]?.url ? `<img src="${esc(p.coverImageUrl || p.photos[0].url)}" alt="" loading="lazy">` : ''}
      <div class="body">
        <h3>${esc(p.title)}</h3>
        ${p.locationName ? `<div class="muted small">📍 ${esc(p.locationName)}</div>` : ''}
        <p class="small" style="margin:6px 0 0">${esc(p.body)}</p>
      </div>
    </article>`;
}

/* ---------- public pages ---------- */
async function openDirectory(push){
  if(push) setUrl('', true);
  state.view = 'loading'; render();
  try{
    await loadAd();
    state.creators = await api('/creators');
    state.view = 'directory';
  }catch(err){ state.error = err.message; state.view = 'error'; }
  render(); window.scrollTo(0, 0);
}

async function openProfile(handle, push){
  if(push) setUrl(`handle=${encodeURIComponent(handle)}`, true);
  state.view = 'loading'; render();
  try{
    await loadAd();
    state.profile = await api(`/creators/${encodeURIComponent(handle)}`, { auth: true });
    state.view = 'profile';
  }catch(err){ state.error = err.message; state.view = 'error'; }
  render(); window.scrollTo(0, 0);
}

async function openJourney(handle, slug, push){
  if(push) setUrl(`handle=${encodeURIComponent(handle)}&journey=${encodeURIComponent(slug)}`, true);
  state.view = 'loading'; render();
  try{
    await loadAd();
    state.journey = await api(`/creators/${encodeURIComponent(handle)}/journeys/${encodeURIComponent(slug)}`);
    state.view = 'journey';
  }catch(err){ state.error = err.message; state.view = 'error'; }
  render(); window.scrollTo(0, 0);
}

async function toggleFollow(){
  const c = state.profile;
  try{
    const res = await api(`/creators/${encodeURIComponent(c.handle)}/follow`, { method: c.isFollowing ? 'DELETE' : 'POST', auth: true });
    c.isFollowing = res.following;
    c.stats.followers = res.followers;
    render();
    toast(res.following ? `Following @${c.handle}` : 'Unfollowed');
  }catch(err){ toast(err.message); }
}

/* ---------- the creator's own panel ---------- */
async function openPanel(push){
  if(push) setUrl('panel=1', true);
  loadAuth();
  if(!state.auth){
    state.view = 'panel'; state.dash = null; render(); return;
  }
  state.view = 'loading'; render();
  try{
    state.dash = await api('/creators/me', { auth: true });
  }catch(err){
    if(err.status === 401){ signedOut(); state.dash = null; }
    else { state.error = err.message; state.view = 'error'; render(); return; }
  }
  state.view = 'panel'; render(); window.scrollTo(0, 0);
}

function panelView(){
  if(!state.auth){
    return `
      <div class="card" style="margin-top:26px">
        <h1 style="font-size:24px">Creator panel</h1>
        <p class="muted">Sign in with your Batoma traveller account to apply for creator access or manage your profile.</p>
        <a class="btn btn-brand btn-block" href="login.html?returnTo=${encodeURIComponent('creator.html')}">Sign in</a>
      </div>`;
  }
  if(!state.dash) return applyForm();

  const { profile, stats, journeys, posts, website } = state.dash;
  const statusPill = profile.status === 'APPROVED' ? '<span class="pill good">Approved</span>'
    : profile.status === 'PENDING' ? '<span class="pill warn">Waiting for Batoma</span>'
    : '<span class="pill bad">Suspended</span>';
  return `
    <div class="sec" style="margin-top:22px"><h2 style="font-size:26px">Creator panel</h2>${statusPill}</div>
    ${profile.status === 'PENDING' ? `<div class="ok" role="status">Batoma is checking your application. You can build journeys now;
      they go public once you are approved.</div>` : ''}
    ${profile.status === 'SUSPENDED' ? `<div class="error" role="alert">Your profile is suspended.
      ${esc(profile.reviewNote || 'Contact Batoma for details.')}</div>` : ''}
    ${profile.status === 'APPROVED' && profile.reviewNote ? `<div class="ok">${esc(profile.reviewNote)}</div>` : ''}
    ${website?.shown && website.url ? `<div class="ok" role="status">Your profile is on the Batoma website, with your journeys and stories.
      <a href="${esc(website.url)}" target="_blank" rel="noopener">View it on the website ↗</a></div>`
      : profile.status === 'APPROVED' ? `<div class="muted small" style="margin:6px 0 12px">Batoma's editors choose creators for the public
      website. Keep publishing journeys: real costs, the road you took and good photos are what they look for.</div>` : ''}

    <div class="card">
      <div class="panel-head">
        <div><h2 style="font-size:20px">${esc(profile.displayName)}</h2>
          <div class="muted">@${esc(profile.handle)}${profile.headline ? ` · ${esc(profile.headline)}` : ''}</div></div>
        <div class="row" style="margin:0">
          <button class="btn btn-ghost btn-sm" data-action="editProfile">Edit profile</button>
          ${profile.status === 'APPROVED' ? `<a class="btn btn-ghost btn-sm" href="creator.html?handle=${encodeURIComponent(profile.handle)}">View public page</a>` : ''}
        </div>
      </div>
      <div class="stats">
        <div class="stat"><b>${stats.journeys}</b><span>Published journeys</span></div>
        <div class="stat"><b>${stats.posts}</b><span>Live adventures</span></div>
        <div class="stat"><b>${stats.upvotes}</b><span>Upvotes</span></div>
        <div class="stat"><b>${stats.followers}</b><span>Followers</span></div>
      </div>
    </div>

    <div class="sec"><h2>Journeys</h2><button class="btn btn-primary btn-sm" data-action="editJourney">+ New journey</button></div>
    <p class="muted small" style="margin-top:0">A journey ties your posts into one trip, with the road, the days, the real cost and the gear.</p>
    <div class="card">
      ${journeys.length ? journeys.map(journeyRow).join('') : '<div class="empty">No journeys yet. Create one and add your posts to it.</div>'}
    </div>

    <div class="sec"><h2>Your adventures</h2><a class="link" href="index.html#write">Write a new one →</a></div>
    <div class="card">
      ${posts.length ? posts.slice(0, 12).map((p) => `
        <div class="post-pick">
          ${p.coverImageUrl ? `<img src="${esc(p.coverImageUrl)}" alt="">` : '<div style="width:56px;height:44px;border-radius:8px;background:var(--surface-2);flex:none"></div>'}
          <div style="flex:1;min-width:0"><strong>${esc(p.title)}</strong>
            <div class="muted small">${p.status === 'PUBLISHED' && p.moderation === 'APPROVED' ? 'Live' : p.moderation === 'PENDING' ? 'Waiting for review' : p.status.toLowerCase()}
              · ${esc(fmtDay(p.publishedAt || p.createdAt))}</div></div>
        </div>`).join('') : '<div class="empty">Nothing written yet. Adventures you publish in the app appear here.</div>'}
    </div>`;
}

function journeyRow(j){
  const status = j.status === 'PUBLISHED' ? '<span class="pill good">Published</span>' : '<span class="pill">Draft</span>';
  return `
    <div class="journey-row">
      <div style="flex:1;min-width:200px">
        <strong>${esc(j.title)}</strong> ${status}
        <div class="muted small">${[j.route?.name, j.dayCount ? plural(j.dayCount, 'day') : '', j.totalCostNpr ? npr(j.totalCostNpr) : '', plural(j.entries.length, 'post')]
          .filter(Boolean).map(esc).join(' · ')}</div>
      </div>
      <div class="row" style="margin:0">
        <button class="btn btn-ghost btn-sm" data-action="manageEntries" data-id="${esc(j.id)}">Posts</button>
        <button class="btn btn-ghost btn-sm" data-action="editJourney" data-id="${esc(j.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="setJourneyStatus" data-id="${esc(j.id)}" data-status="${j.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'}">
          ${j.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-danger btn-sm" data-action="deleteJourney" data-id="${esc(j.id)}">Delete</button>
      </div>
    </div>`;
}

function applyForm(){
  return `
    <div class="card" style="margin-top:22px">
      <h1 style="font-size:24px">Apply for creator access</h1>
      <p class="muted">Pick a handle and tell readers who you are. A Batoma admin checks each application, usually within a few days.
        You can start building journeys straight away.</p>
      <form data-submit="submitApply" novalidate>
        <div class="two">
          <div><label for="handle">Handle</label>
            <input id="handle" maxlength="24" placeholder="e.g. sunita_treks" autocapitalize="none">
            <div class="hint">Lower-case letters, numbers and underscores. This is your profile address and cannot be changed.</div></div>
          <div><label for="displayName">Display name</label><input id="displayName" maxlength="60"></div>
        </div>
        <label for="headline">One line about you</label>
        <input id="headline" maxlength="120" placeholder="e.g. Slow trekking and mountain food, mostly in the mid-hills">
        <label for="bio">About you</label>
        <textarea id="bio" maxlength="1000"></textarea>
        <div class="two">
          <div><label for="homeBase">Where you're based</label><input id="homeBase" maxlength="80" placeholder="e.g. Pokhara"></div>
          <div><label for="specialities">What you cover</label>
            <input id="specialities" maxlength="120" placeholder="trekking, food, photography">
            <div class="hint">Separate with commas.</div></div>
        </div>
        ${state.formError ? `<div class="error" role="alert">${esc(state.formError)}</div>` : ''}
        <button class="btn btn-brand btn-block" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending…' : 'Apply'}</button>
      </form>
    </div>`;
}

async function submitApply(e){
  e.preventDefault();
  const dto = {
    handle: $('#handle').value.trim().toLowerCase(),
    displayName: $('#displayName').value.trim(),
    headline: $('#headline').value.trim() || undefined,
    bio: $('#bio').value.trim() || undefined,
    homeBase: $('#homeBase').value.trim() || undefined,
    specialities: $('#specialities').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
  };
  if(!/^[a-z0-9_]{3,24}$/.test(dto.handle)){ state.formError = 'Handles are 3–24 characters: lower-case letters, numbers and underscores.'; render(); return; }
  if(dto.displayName.length < 2){ state.formError = 'Enter the name you want on your profile.'; render(); return; }
  state.busy = true; state.formError = ''; render();
  try{
    state.dash = await api('/creators/apply', { method: 'POST', body: dto, auth: true });
    state.busy = false;
    render();
    toast('Application sent. Batoma will review it.');
  }catch(err){
    state.busy = false; state.formError = err.message; render();
  }
}

/* ---------- panel dialogs ---------- */
function dialog({ title, intro = '', fields, values = {}, submitLabel = 'Save', onSubmit }){
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const field = (f) => {
      const id = `d-${f.name}`;
      const val = values[f.name] ?? '';
      const control = f.type === 'textarea'
        ? `<textarea id="${id}" maxlength="${f.maxlength || 2000}">${esc(val)}</textarea>`
        : f.type === 'select'
          ? `<select id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
          : `<input id="${id}" type="${f.type || 'text'}" maxlength="${f.maxlength || 200}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}">`;
      return `<div class="${f.full ? '' : 'half'}"><label for="${id}">${esc(f.label)}</label>${control}
        ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    };
    back.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="d-title" novalidate>
        <h2 id="d-title">${esc(title)}</h2>
        ${intro ? `<p class="muted small">${esc(intro)}</p>` : ''}
        ${fields.map(field).join('')}
        <div class="error" role="alert" hidden></div>
        <div class="row">
          <button class="btn btn-brand" type="submit">${esc(submitLabel)}</button>
          <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
    const close = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-cancel]')) close(null); });
    back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(null); });
    back.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = {};
      for(const f of fields) out[f.name] = $(`#d-${f.name}`, back).value.trim();
      const box = back.querySelector('.error');
      const btn = back.querySelector('button[type="submit"]');
      btn.disabled = true;
      try{ close(await onSubmit(out)); }
      catch(err){ box.textContent = err.message; box.hidden = false; btn.disabled = false; }
    });
    document.body.appendChild(back);
    back.querySelector('input,textarea,select')?.focus();
  });
}

async function editProfile(){
  const p = state.dash.profile;
  const saved = await dialog({
    title: 'Edit profile', submitLabel: 'Save profile',
    fields: [
      { name: 'displayName', label: 'Display name', maxlength: 60 },
      { name: 'headline', label: 'One line about you', maxlength: 120 },
      { name: 'bio', label: 'About you', type: 'textarea', maxlength: 1000 },
      { name: 'homeBase', label: 'Where you are based', maxlength: 80 },
      { name: 'specialities', label: 'What you cover', hint: 'Separate with commas', maxlength: 120 },
      { name: 'languages', label: 'Languages', hint: 'Separate with commas', maxlength: 120 },
      { name: 'websiteUrl', label: 'Website (https://)', maxlength: 300 },
      { name: 'instagram', label: 'Instagram handle', maxlength: 60 },
    ],
    values: { ...p, specialities: (p.specialities || []).join(', '), languages: (p.languages || []).join(', ') },
    onSubmit: (v) => api('/creators/me', {
      method: 'PATCH', auth: true,
      body: {
        ...v,
        specialities: v.specialities.split(',').map((s) => s.trim()).filter(Boolean),
        languages: v.languages.split(',').map((s) => s.trim()).filter(Boolean),
        websiteUrl: v.websiteUrl || undefined,
      },
    }),
  });
  if(saved){ state.dash = saved; render(); toast('Profile saved.'); }
}

async function editJourney(id){
  const j = id ? state.dash.journeys.find((x) => x.id === id) : {};
  const saved = await dialog({
    title: id ? 'Edit journey' : 'New journey',
    intro: 'Give readers the road, the length, the real cost and what you carried.',
    submitLabel: id ? 'Save journey' : 'Create journey',
    fields: [
      { name: 'title', label: 'Title', maxlength: 140, placeholder: 'e.g. Five days on the Annapurna foothills' },
      { name: 'summary', label: 'Summary', type: 'textarea', maxlength: 600 },
      { name: 'dayCount', label: 'How many days', type: 'number' },
      { name: 'startedOn', label: 'Started on', type: 'date' },
      { name: 'transportNpr', label: 'Transport (NPR)', type: 'number' },
      { name: 'stayNpr', label: 'Stay (NPR)', type: 'number' },
      { name: 'foodNpr', label: 'Food (NPR)', type: 'number' },
      { name: 'permitsNpr', label: 'Permits (NPR)', type: 'number' },
      { name: 'otherNpr', label: 'Other (NPR)', type: 'number' },
      { name: 'gear', label: 'Gear worth carrying', hint: 'Separate with commas', maxlength: 400 },
      { name: 'tips', label: 'Tips for others', type: 'textarea', maxlength: 2000 },
    ],
    values: { ...j, startedOn: j.startedOn ? String(j.startedOn).slice(0, 10) : '', gear: (j.gear || []).join(', ') },
    onSubmit: (v) => {
      const num = (x) => (x === '' ? undefined : Number(x));
      const body = {
        title: v.title, summary: v.summary || undefined, dayCount: num(v.dayCount), startedOn: v.startedOn || undefined,
        transportNpr: num(v.transportNpr), stayNpr: num(v.stayNpr), foodNpr: num(v.foodNpr),
        permitsNpr: num(v.permitsNpr), otherNpr: num(v.otherNpr), tips: v.tips || undefined,
        gear: v.gear.split(',').map((s) => s.trim()).filter(Boolean),
      };
      return id ? api(`/creators/me/journeys/${id}`, { method: 'PATCH', body, auth: true })
        : api('/creators/me/journeys', { method: 'POST', body, auth: true });
    },
  });
  if(saved){ state.dash = saved; render(); toast('Journey saved.'); }
}

async function setJourneyStatus(id, status){
  try{
    state.dash = await api(`/creators/me/journeys/${id}/status`, { method: 'PATCH', body: { status }, auth: true });
    render();
    toast(status === 'PUBLISHED' ? 'Journey published.' : 'Journey unpublished.');
  }catch(err){ toast(err.message); }
}

async function deleteJourney(id){
  const j = state.dash.journeys.find((x) => x.id === id);
  if(!confirmDelete(j?.title)) return;
  try{
    state.dash = await api(`/creators/me/journeys/${id}`, { method: 'DELETE', auth: true });
    render(); toast('Journey deleted.');
  }catch(err){ toast(err.message); }
}
function confirmDelete(title){ return window.confirm(`Delete “${title}”? The posts stay in your account.`); }

/** Choose which of the creator's posts belong to a journey, and in what order. */
async function manageEntries(journeyId){
  const journey = state.dash.journeys.find((j) => j.id === journeyId);
  const chosen = new Set(journey.entries.map((e) => e.post.id));
  const back = document.createElement('div');
  back.className = 'modal-back';
  const paint = () => {
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="e-title">
        <div class="panel-head"><h2 id="e-title">${esc(journey.title)}</h2>
          <button class="btn btn-ghost btn-sm" data-close>Done</button></div>
        <p class="muted small">Tick the adventures that belong to this journey. Drag order comes from the order you add them.</p>
        <div style="margin-top:10px">
          ${state.dash.posts.length ? state.dash.posts.map((p) => `
            <div class="post-pick">
              ${p.coverImageUrl ? `<img src="${esc(p.coverImageUrl)}" alt="">` : '<div style="width:56px;height:44px;border-radius:8px;background:var(--surface-2);flex:none"></div>'}
              <div style="flex:1;min-width:0"><strong>${esc(p.title)}</strong>
                <div class="muted small">${esc(fmtDay(p.publishedAt || p.createdAt))}</div></div>
              <button class="btn btn-sm ${chosen.has(p.id) ? 'btn-ghost' : 'btn-brand'}" data-toggle="${esc(p.id)}">
                ${chosen.has(p.id) ? 'Remove' : 'Add'}</button>
            </div>`).join('') : '<div class="empty">Write an adventure in the app first.</div>'}
        </div>
      </div>`;
  };
  paint();
  back.addEventListener('click', async (e) => {
    if(e.target === back || e.target.closest('[data-close]')){ back.remove(); render(); return; }
    const btn = e.target.closest('[data-toggle]');
    if(!btn) return;
    const postId = btn.dataset.toggle;
    btn.disabled = true;
    try{
      state.dash = chosen.has(postId)
        ? await api(`/creators/me/journeys/${journeyId}/posts/${postId}`, { method: 'DELETE', auth: true })
        : await api(`/creators/me/journeys/${journeyId}/posts`, { method: 'POST', body: { postId }, auth: true });
      chosen.has(postId) ? chosen.delete(postId) : chosen.add(postId);
      Object.assign(journey, state.dash.journeys.find((j) => j.id === journeyId));
      paint();
    }catch(err){ toast(err.message); btn.disabled = false; }
  });
  back.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ back.remove(); render(); } });
  document.body.appendChild(back);
}

route();

Actions.on({
  adClicked: (el) => adClicked(el.dataset.id),
  openDirectory: () => openDirectory(true),
  // Links keep a real address for new tabs and crawlers; a plain click stays in the page.
  openProfile: (el, ev) => { if(ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.preventDefault(); openProfile(el.dataset.handle, true); },
  openJourney: (el, ev) => { if(ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.preventDefault(); openJourney(el.dataset.handle, el.dataset.slug, true); },
  toggleFollow: () => toggleFollow(),
  editProfile: () => editProfile(),
  editJourney: (el) => editJourney(el.dataset.id || null),
  manageEntries: (el) => manageEntries(el.dataset.id),
  setJourneyStatus: (el) => setJourneyStatus(el.dataset.id, el.dataset.status),
  deleteJourney: (el) => deleteJourney(el.dataset.id),
});
Actions.onSubmit({ submitApply: (_form, ev) => submitApply(ev) });
