/* Batoma for partners: a business owner's listing, enquiries, deals, reviews and monthly report. */
(function () {
  'use strict';

  const API = window.BATO_CONFIG?.api || 'http://localhost:3000/api/v1';
  const SITE = (window.BATO_CONFIG?.site || '').replace(/\/$/, '');
  const AUTH_KEY = 'bato.auth';
  const PICK_KEY = 'bato.partner.business';
  const $ = (s, root = document) => root.querySelector(s);
  const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SCREENS = [
    ['overview', 'Overview'], ['enquiries', 'Enquiries'], ['deals', 'Deals'], ['reviews', 'Reviews'], ['report', 'Monthly report'], ['listing', 'Your listing'],
  ];
  const LEAD_TYPE = {
    PROFILE_VIEW: 'Profile views', CALL: 'Calls', WHATSAPP: 'WhatsApp', VIBER: 'Viber', DIRECTIONS: 'Directions',
    WEBSITE: 'Website visits', ENQUIRY: 'Enquiries', COUPON_VIEW: 'Deal views',
  };
  const REPORT = [
    ['impressions', 'Website impressions'], ['clicks', 'Website clicks'], ['profileViews', 'App profile views'],
    ['contactTaps', 'Calls, WhatsApp, directions'], ['enquiries', 'Enquiries'], ['couponsIssued', 'Coupons claimed'], ['couponsRedeemed', 'Coupons redeemed'],
  ];
  const TIER = { FREE: 'Free listing', VERIFIED: 'Verified', FEATURED: 'Featured partner', PREMIUM: 'Premium partner' };

  const state = { auth: null, businesses: [], biz: null, screen: 'overview', page: 1, month: '', busy: false };

  /* ---------- formatting ---------- */
  const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtBoth = (d) => { if (!d) return ''; const bs = window.BsDate?.formatBs(new Date(d).toISOString().slice(0, 10)); return bs ? `${fmtDay(d)} · ${bs}` : fmtDay(d); };
  const fmtTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const num = (n) => Number(n ?? 0).toLocaleString('en-IN');
  const stars = (n) => { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); };
  const thisMonth = () => new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 7);
  /** A reply link for whatever the traveller gave: a phone number or an email address. */
  function contactLink(c) {
    const s = String(c || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
    const digits = s.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length >= 7) return `<a href="tel:${esc(digits)}">${esc(s)}</a>`;
    return esc(s);
  }

  /* ---------- session: the same sign-in as the reader ---------- */
  const jwtExpiry = (t) => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (_) { return 0; } };
  const expiresSoon = (t) => jwtExpiry(t) - Date.now() < 30_000;
  const loadAuth = () => { try { state.auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { state.auth = null; } };

  let refreshing = null;
  /** One refresh at a time across tabs (same lock as the reader): a refresh token used twice ends the session. */
  function refreshSession() {
    if (refreshing) return refreshing;
    const run = async () => {
      const stored = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (!stored?.refreshToken) throw Object.assign(new Error('signed out'), { expired: true });
      if (stored.accessToken !== state.auth?.accessToken && !expiresSoon(stored.accessToken)) { state.auth = stored; return stored; }
      const res = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: stored.refreshToken }) });
      if (!res.ok) throw Object.assign(new Error('Could not refresh the session'), { expired: res.status === 401 });
      const { data } = await res.json();
      state.auth = { ...stored, accessToken: data.accessToken, refreshToken: data.refreshToken };
      localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth));
      return state.auth;
    };
    refreshing = (navigator.locks ? navigator.locks.request('bato-refresh', run) : run()).finally(() => { refreshing = null; });
    return refreshing;
  }

  async function authed(url, opts = {}) {
    const ended = () => { signedOut('Your session ended. Please sign in again.'); return Object.assign(new Error('Session ended'), { silent: true }); };
    if (!state.auth) throw ended();
    if (expiresSoon(state.auth.accessToken)) { try { await refreshSession(); } catch (e) { if (e.expired) throw ended(); } }
    const call = () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${state.auth.accessToken}` } });
    let res = await call();
    if (res.status === 401) {
      try { await refreshSession(); } catch (e) { if (e.expired) throw ended(); throw e; }
      res = await call();
      if (res.status === 401) throw ended();
    }
    return res;
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await authed(`${API}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      if (e.silent) throw e;
      throw new Error('Batoma is not reachable. Check your internet connection and try again.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json?.message || 'Something went wrong. Please try again.'), { status: res.status });
    return json.data;
  }

  async function download(path) {
    const res = await authed(`${API}${path}`);
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.message || 'That file could not be made. Try again.'); }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'batoma-report';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function signedOut(message) {
    state.auth = null;
    $('#tabs').hidden = true;
    $('#who').innerHTML = '';
    $('#main').innerHTML = `
      <div class="card">
        <h1>Batoma for partners</h1>
        ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
        <p>Sign in with the email address your listing was registered with to see your enquiries, deals, reviews and monthly report.</p>
        <p><a class="btn" href="/login.html?returnTo=business.html">Sign in</a></p>
        <p class="muted small">Not a partner yet? ${SITE ? `<a href="${esc(SITE)}/advertise">Ask about a listing</a>.` : 'Ask the Batoma team about a listing.'}</p>
      </div>`;
  }

  function signOut() {
    const auth = state.auth;
    localStorage.removeItem(AUTH_KEY);
    if (auth?.refreshToken) fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: auth.refreshToken }) }).catch(() => {});
    signedOut('');
  }

  let noticeTimer;
  function notify(text, kind = 'ok') {
    const box = $('#notice');
    box.className = `notice ${kind}`; box.textContent = text; box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6500 : 3500);
  }

  /* ---------- shell ---------- */
  function renderShell() {
    const b = state.biz;
    $('#who').innerHTML = `
      ${state.businesses.length > 1 ? `<label class="sr-only" for="pick">Listing</label><select id="pick" data-change="pickBusiness">${state.businesses.map((x) =>
        `<option value="${esc(x.id)}" ${x.id === b?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
      <button class="btn btn-ghost" data-action="signOut">Sign out</button>`;
    const tabs = $('#tabs');
    tabs.hidden = !b;
    tabs.innerHTML = SCREENS.map(([k, label]) => `<a href="#/${k}" ${k === state.screen ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  }

  const head = (title, sub = '', actions = '') => `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
  const loading = () => { $('#main').innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>'; };

  let seq = 0;
  async function render() {
    renderShell();
    const main = $('#main');
    if (!state.biz) {
      main.innerHTML = `<div class="card"><h1>No listing yet</h1>
        <p>This account has no Batoma listing. If you run a hotel, restaurant or agency on the road, the team can set one up and verify it.</p>
        ${SITE ? `<p><a class="btn" href="${esc(SITE)}/advertise">Ask about a listing</a></p>` : ''}</div>`;
      return;
    }
    const mine = ++seq;
    loading();
    try {
      const html = await VIEWS[state.screen]();
      if (mine === seq) main.innerHTML = html;
    } catch (e) {
      if (e.silent || mine !== seq) return;
      main.innerHTML = `<div class="card"><h2>Could not load this</h2><p class="error" role="alert">${esc(e.message)}</p><button class="btn btn-ghost" data-action="reload">Try again</button></div>`;
    }
  }

  /* ---------- screens ---------- */
  const VIEWS = {
    async overview() {
      const b = state.biz;
      const d = await api(`/businesses/${b.id}/dashboard?days=30`);
      const contacts = d.leadsByType.filter((l) => l.type !== 'PROFILE_VIEW').reduce((s, l) => s + l.count, 0);
      const views = d.leadsByType.find((l) => l.type === 'PROFILE_VIEW')?.count ?? 0;
      return `
        ${head(b.name, `${esc(TIER[b.tier] || b.tier)} · last 30 days`, SITE && b.verifiedAt ? `<a class="btn btn-ghost" href="${esc(SITE)}/partners/${esc(b.slug)}" rel="noopener" target="_blank">See it on the website</a>` : '')}
        ${!b.verifiedAt ? '<div class="banner warn" role="status"><b>Waiting for verification.</b> Batoma checks every listing before it is shown on the website and in the app.</div>' : ''}
        <div class="kpis">
          <div class="kpi"><b>${num(views)}</b><span>Profile views in the app</span></div>
          <div class="kpi"><b>${num(contacts)}</b><span>Calls, messages and enquiries</span></div>
          <div class="kpi"><b>${num(d.couponSummary.claimed)}</b><span>Deals claimed</span></div>
          <div class="kpi"><b>${d.rating.average != null ? `${d.rating.average.toFixed(1)}★` : '—'}</b><span>${num(d.rating.count)} ${d.rating.count === 1 ? 'review' : 'reviews'}</span></div>
        </div>
        <div class="card">
          <h2>How travellers reached you</h2>
          ${d.leadsByType.length ? `<ul class="list">${d.leadsByType.sort((a, z) => z.count - a.count).map((l) =>
            `<li class="row"><span>${esc(LEAD_TYPE[l.type] || l.type)}</span><b>${num(l.count)}</b></li>`).join('')}</ul>` : '<p class="empty">Nothing in the last 30 days yet.</p>'}
        </div>
        ${d.leadsByRoute.length ? `<div class="card"><h2>From which road</h2><ul class="list">${d.leadsByRoute.map((r) =>
          `<li class="row"><span>${esc(r.route)}</span><b>${num(r.leads)}</b></li>`).join('')}</ul></div>` : ''}
        <p class="muted small">The monthly report adds what the website did for you: how often you were shown and clicked.</p>`;
    },

    async enquiries() {
      const r = await api(`/businesses/${state.biz.id}/leads?page=${state.page}`);
      return `
        ${head('Enquiries', 'Messages travellers sent you from the website and the app. Each one was also emailed to you.')}
        <div class="card">
          ${r.items.length ? `<ul class="list">${r.items.map((l) => `
            <li>
              <div class="row"><b>${esc(l.name || 'A traveller')}</b><span class="muted small">${esc(fmtBoth(l.createdAt))}, ${esc(fmtTime(l.createdAt))} · ${l.channel === 'SITE' ? 'website' : 'app'}</span></div>
              ${l.message ? `<p class="msg">${esc(l.message)}</p>` : ''}
              ${l.contact ? `<p class="small">Reply to: ${contactLink(l.contact)}</p>` : ''}
            </li>`).join('')}</ul>` : '<p class="empty">No enquiries yet. When a traveller writes to you, it appears here and in your email.</p>'}
        </div>
        ${r.pages > 1 ? `<div class="actions">
          ${state.page > 1 ? '<button class="btn btn-ghost" data-action="pageBy" data-by="-1">← Newer</button>' : ''}
          <span class="muted">Page ${r.page} of ${r.pages}</span>
          ${state.page < r.pages ? '<button class="btn btn-ghost" data-action="pageBy" data-by="1">Older →</button>' : ''}
        </div>` : ''}`;
    },

    async deals() {
      const d = await api(`/businesses/${state.biz.id}/dashboard?days=30`);
      const now = Date.now();
      const live = (c) => c.isActive !== false && new Date(c.validTo).getTime() > now;
      return `
        ${head('Deals', 'Offers travellers claim in the Batoma app and show when they pay.')}
        <div class="card">
          <h2>Redeem a code</h2>
          <form class="stack" data-submit="redeem">
            <div><label for="code">Code the traveller shows you</label><input id="code" name="code" required autocomplete="off" autocapitalize="characters" maxlength="40"></div>
            <div><button class="btn" type="submit">Redeem</button></div>
          </form>
        </div>
        <div class="card">
          <h2>Your deals</h2>
          ${d.coupons.length ? `<ul class="list">${d.coupons.map((c) => `
            <li class="row">
              <div><b>${esc(c.discountLabel)}</b> · ${esc(c.title)}<br>
                <span class="muted small">${live(c) ? `Until ${esc(fmtBoth(c.validTo))}` : 'Ended'} · ${num(c.claimed)} claimed · ${num(c.redeemed)} redeemed</span></div>
              ${live(c) ? `<button class="btn btn-danger" data-action="endDeal" data-id="${esc(c.id)}" data-title="${esc(c.title)}">End now</button>` : '<span class="pill">Ended</span>'}
            </li>`).join('')}</ul>` : '<p class="empty">No deals yet.</p>'}
        </div>
        <div class="card">
          <h2>New deal</h2>
          <form class="stack" data-submit="newDeal">
            <div class="grid2">
              <div><label for="dl">Offer</label><input id="dl" name="discountLabel" required maxlength="60" placeholder="10% off"></div>
              <div><label for="dt">Title</label><input id="dt" name="title" required maxlength="160" placeholder="10% off dinner for bus travellers"></div>
            </div>
            <div><label for="dd">Details</label><textarea id="dd" name="description" maxlength="500" placeholder="What is included, when it applies"></textarea></div>
            <div class="grid2">
              <div><label for="dv">Ends on</label><input id="dv" name="validTo" type="date" required min="${new Date(now + 86_400_000).toISOString().slice(0, 10)}"></div>
              <div><label for="dm">Most codes to give out</label><input id="dm" name="maxRedemptions" type="number" min="1" inputmode="numeric"><p class="hint">Leave empty for no limit.</p></div>
            </div>
            <div><button class="btn" type="submit">Publish deal</button></div>
          </form>
        </div>`;
    },

    async reviews() {
      const b = await api(`/businesses/${encodeURIComponent(state.biz.slug)}`);
      return `
        ${head('Reviews', b.rating?.average ? `<span class="stars">${stars(b.rating.average)}</span> ${b.rating.average.toFixed(1)} from ${num(b.rating.count)}` : 'What travellers said, after a check by Batoma moderators.')}
        <div class="card">
          ${b.reviews?.length ? `<ul class="list">${b.reviews.map((r) => `
            <li>
              <div class="row"><span><span class="stars" aria-label="${r.rating} of 5">${stars(r.rating)}</span> ${esc(r.user?.name || 'Traveller')}${r.redemptionId ? ' <span class="pill good">Used a deal</span>' : ''}</span><span class="muted small">${esc(fmtBoth(r.createdAt))}</span></div>
              ${r.body ? `<p class="msg">${esc(r.body)}</p>` : ''}
              ${r.reply ? `<p class="small"><b>Your reply:</b> ${esc(r.reply)}</p>` : ''}
              <form class="stack" data-submit="reply" data-id="${esc(r.id)}">
                <div><label for="rp-${esc(r.id)}">${r.reply ? 'Change your reply' : 'Reply in public'}</label><textarea id="rp-${esc(r.id)}" name="reply" maxlength="1000" required>${esc(r.reply || '')}</textarea></div>
                <div><button class="btn btn-ghost" type="submit">${r.reply ? 'Update reply' : 'Post reply'}</button></div>
              </form>
            </li>`).join('')}</ul>` : '<p class="empty">No reviews yet.</p>'}
        </div>`;
    },

    async report() {
      const month = state.month || thisMonth();
      const r = await api(`/businesses/${state.biz.id}/report?month=${month}`);
      const active = r.days.filter((d) => REPORT.some(([k]) => d[k]));
      return `
        ${head('Monthly report', 'What Batoma did for you this month. Download it to share or keep.', `
          <button class="btn btn-ghost" data-action="downloadReport" data-kind="csv">Spreadsheet (CSV)</button>
          <button class="btn btn-ghost" data-action="downloadReport" data-kind="pdf">PDF</button>`)}
        <form class="card stack" data-submit="pickMonth">
          <div class="grid2">
            <div><label for="month">Month</label><input id="month" name="month" type="month" value="${esc(month)}" max="${thisMonth()}" required></div>
            <div><label class="sr-only" for="show">Show</label><button id="show" class="btn" type="submit">Show</button></div>
          </div>
        </form>
        <div class="kpis">${REPORT.map(([k, label]) => `<div class="kpi"><b>${num(r.totals[k])}</b><span>${esc(label)}</span></div>`).join('')}
          <div class="kpi"><b>${r.ctr == null ? '—' : `${(r.ctr * 100).toFixed(1)}%`}</b><span>Website clicks per impression</span></div></div>
        <div class="card">
          <h2>Day by day</h2>
          ${active.length ? `<div class="scroll"><table>
            <thead><tr><th scope="col">Day</th>${REPORT.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead>
            <tbody>${active.map((d) => `<tr><td>${esc(fmtBoth(`${d.day}T06:00:00Z`))}</td>${REPORT.map(([k]) => `<td>${num(d[k])}</td>`).join('')}</tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td>${REPORT.map(([k]) => `<td>${num(r.totals[k])}</td>`).join('')}</tr></tfoot>
          </table></div>` : '<p class="empty">Nothing recorded in this month.</p>'}
        </div>`;
    },

    async listing() {
      const b = await api(`/businesses/${encodeURIComponent(state.biz.slug)}`);
      const f = (name, label, value, type = 'text', hint = '') => `<div><label for="l-${name}">${esc(label)}</label><input id="l-${name}" name="${name}" type="${type}" value="${esc(value ?? '')}" maxlength="200">${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</div>`;
      return `
        ${head('Your listing', 'What travellers see on the website and in the app. Changes show within a few minutes.')}
        <form class="card stack" data-submit="saveListing">
          <div><label for="l-description">About you</label><textarea id="l-description" name="description" maxlength="2000">${esc(b.description || '')}</textarea></div>
          <div class="grid2">
            ${f('phone', 'Phone', b.phone, 'tel')}
            ${f('whatsapp', 'WhatsApp', b.whatsapp, 'tel')}
            ${f('viber', 'Viber', b.viber, 'tel')}
            ${f('website', 'Website', b.website, 'url', 'Starting with https://')}
            ${f('priceRange', 'Price range', b.priceRange, 'text', 'For example NPR 1,500 – 4,000')}
            ${f('address', 'Address', b.address)}
          </div>
          <div><label for="l-amenities">What you offer</label><input id="l-amenities" name="amenities" value="${esc((b.amenities || []).join(', '))}" maxlength="500"><p class="hint">Separate with commas: Wi-Fi, Hot water, Parking</p></div>
          <div><button class="btn" type="submit">Save</button></div>
        </form>`;
    },
  };

  /* ---------- actions ---------- */
  async function busy(el, run) {
    const btn = el.matches('form') ? el.querySelector('[type="submit"]') : el;
    if (btn) btn.disabled = true;
    try { await run(); } catch (e) { if (!e.silent) notify(e.message, 'error'); } finally { if (btn) btn.disabled = false; }
  }
  const values = (form) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));

  Actions.on({
    signOut,
    pageBy: (el) => { state.page = Math.max(1, state.page + Number(el.dataset.by)); render(); },
    endDeal: (el) => busy(el, async () => {
      if (!window.confirm(`End “${el.dataset.title}” now? Travellers can no longer claim it; codes already claimed still work.`)) return;
      await api(`/businesses/coupons/${el.dataset.id}/end`, { method: 'PATCH' });
      notify('Deal ended');
      render();
    }),
    downloadReport: (el) => busy(el, () => download(`/businesses/${state.biz.id}/report.${el.dataset.kind}?month=${state.month || thisMonth()}`)),
  });
  Actions.onChange({
    pickBusiness: (el) => { choose(el.value); state.page = 1; render(); },
  });
  Actions.onSubmit({
    redeem: (form, e) => { e.preventDefault(); busy(form, async () => {
      const code = values(form).code.toUpperCase();
      await api(`/businesses/coupons/redeem/${encodeURIComponent(code)}`, { method: 'POST' });
      notify(`Code ${code} redeemed`);
      form.reset();
    }); },
    newDeal: (form, e) => { e.preventDefault(); busy(form, async () => {
      const v = values(form);
      await api(`/businesses/${state.biz.id}/coupons`, { method: 'POST', body: {
        title: v.title, discountLabel: v.discountLabel, description: v.description || undefined,
        // The deal runs to the end of its last day in Nepal.
        validTo: new Date(`${v.validTo}T23:59:59+05:45`).toISOString(),
        maxRedemptions: v.maxRedemptions ? Number(v.maxRedemptions) : undefined,
      } });
      notify('Deal published');
      render();
    }); },
    reply: (form, e) => { e.preventDefault(); busy(form, async () => {
      await api(`/businesses/reviews/${form.dataset.id}/reply`, { method: 'PATCH', body: { reply: values(form).reply } });
      notify('Reply posted');
      render();
    }); },
    pickMonth: (form, e) => { e.preventDefault(); state.month = values(form).month; render(); },
    saveListing: (form, e) => { e.preventDefault(); busy(form, async () => {
      const v = values(form);
      await api(`/businesses/${state.biz.id}`, { method: 'PATCH', body: {
        description: v.description, phone: v.phone, whatsapp: v.whatsapp, viber: v.viber, website: v.website,
        priceRange: v.priceRange, address: v.address, amenities: v.amenities.split(',').map((s) => s.trim()).filter(Boolean),
      } });
      notify('Listing saved');
    }); },
  });

  /* ---------- start ---------- */
  function choose(id) {
    state.biz = state.businesses.find((b) => b.id === id) || state.businesses[0] || null;
    try { if (state.biz) localStorage.setItem(PICK_KEY, state.biz.id); } catch (_) {}
  }

  function fromHash() {
    const k = location.hash.replace(/^#\/?/, '');
    state.screen = SCREENS.some(([s]) => s === k) ? k : 'overview';
  }

  window.addEventListener('hashchange', () => { fromHash(); state.page = 1; render(); $('#main').focus(); });

  async function start() {
    loadAuth();
    if (!state.auth?.accessToken) return signedOut('');
    fromHash();
    try {
      state.businesses = await api('/businesses/mine');
    } catch (e) {
      if (!e.silent) $('#main').innerHTML = `<div class="card"><h1>Could not load your listing</h1><p class="error" role="alert">${esc(e.message)}</p><button class="btn btn-ghost" data-action="reload">Try again</button></div>`;
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(PICK_KEY); } catch (_) {}
    choose(saved);
    render();
  }
  Actions.on({ reload: () => (state.businesses.length ? render() : start()) });

  start();
})();
