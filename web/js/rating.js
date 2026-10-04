/* ==========================================================================
   "How's this bus?": the rating, second to the magazine and never in its way.

   A classic script loaded after reader.js, sharing its globals (state, esc, toast,
   render, authed, API, isDemo). The card is only offered once the traveller has had
   something from Batoma first — a finished story, or about five minutes of reading —
   and then at the end of every story, under More, and once near the end of the
   journey. It can be snoozed or dismissed, and goes away once this ride is rated.

   The rating itself happens here, in a sheet, not on another page: one tap for the
   stars, then optional part scores, then an optional comment and a private
   suggestion. Every server rule still applies (scan token, one review per bus per
   device or account every 20 hours, the word filter, moderation, anonymity); the
   server, not this page, works out which crew was on duty.
   ========================================================================== */

const RATING_READ_MS = 5 * 60_000;
const RATING_SNOOZE_MS = 45 * 60_000;
const RATING_RIDE_MS = 12 * 3_600_000;
const RATING_REPEAT_MS = 20 * 3_600_000;
const RATING_PARTS = [['cleanliness', 'Cleanliness'], ['driving', 'Safe driving'], ['punctuality', 'On time'], ['staff', 'Staff']];

state.rating = { open: false, step: 1, overall: 0, parts: {}, comment: '', suggestion: '', sending: false, result: null };
state.readingSince = Date.now();
state.finishedStory = false;

/** Per-bus memory on the phone: when it was rated, snoozed or dismissed. */
function ratingMemory(){
  try{ return JSON.parse(localStorage.getItem('bato.rating') || '{}'); }catch(_){ return {}; }
}
function rememberRating(busId, patch){
  const all = ratingMemory();
  all[busId] = { ...(all[busId] || {}), ...patch };
  try{ localStorage.setItem('bato.rating', JSON.stringify(all)); }catch(_){}
}

/** Whether this bus can be rated from here at all, regardless of timing. */
function ratingAvailable(){
  const bus = state.bus;
  if(!bus || isDemo()) return false;
  const m = ratingMemory()[bus.id] || {};
  if(m.reviewedAt && Date.now() - m.reviewedAt < RATING_REPEAT_MS) return false;
  return true;
}

/** Whether to offer the card unprompted: not dismissed for this ride, not snoozed, and earned. */
function ratingOffered(){
  if(!ratingAvailable()) return false;
  const m = ratingMemory()[state.bus.id] || {};
  if(m.dismissedAt && Date.now() - m.dismissedAt < RATING_RIDE_MS) return false;
  if(m.snoozedUntil && Date.now() < m.snoozedUntil) return false;
  return state.finishedStory || Date.now() - state.readingSince >= RATING_READ_MS;
}

/** The card. `where` decides whether it can be dismissed: under More it simply stays. */
function ratingCard(where){
  const bus = state.bus;
  if(!bus) return '';
  const name = bus.label || bus.registrationNo;
  return `
    <section class="rate-card" aria-labelledby="rate-${where}">
      <div class="rate-head">
        <h3 id="rate-${where}">How's this bus?</h3>
        ${where !== 'more' ? `<button class="rate-x" data-action="ratingDismiss" aria-label="Don't ask about this ride">×</button>` : ''}
      </div>
      <p>${esc(name)}${state.operator ? ` · ${esc(state.operator.name)}` : ''}. The company reads what you say, never who said it.</p>
      <div class="rate-stars" role="group" aria-label="Rate this bus out of five">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="rate-star" data-action="ratingOpen" data-n="${n}" aria-label="${n} star${n === 1 ? '' : 's'}">☆</button>`).join('')}
      </div>
      ${where !== 'more' ? `<button class="link rate-later" data-action="ratingSnooze">Not now</button>` : ''}
    </section>`;
}

/**
 * What the reader's screens call. Under More it is always there; at the end of a story it
 * is offered unless snoozed or dismissed (reaching the end is the reading); on the Read
 * screen only once it has been earned.
 */
function ratingSlot(where){
  if(where === 'more') return ratingAvailable() ? ratingCard('more') : '';
  if(where === 'article'){
    if(!ratingAvailable()) return '';
    const m = ratingMemory()[state.bus.id] || {};
    const quiet = (m.dismissedAt && Date.now() - m.dismissedAt < RATING_RIDE_MS) || (m.snoozedUntil && Date.now() < m.snoozedUntil);
    return quiet ? '' : ratingCard('article');
  }
  return ratingOffered() ? ratingCard(where) : '';
}

/* ---------- the sheet ---------- */

function openRating(overall){
  if(!ratingAvailable()) return;
  Object.assign(state.rating, { open: true, step: overall ? 2 : 1, overall: overall || 0, parts: {}, comment: '', suggestion: '', sending: false, result: null });
  state.rating.returnFocus = document.activeElement;
  paintRating();
}

function starRow(name, value, label, big){
  return `<div class="rate-row${big ? ' big' : ''}" role="radiogroup" aria-label="${esc(label)}">
    ${!big ? `<span class="rate-label">${esc(label)}</span>` : ''}
    <span class="rate-row-stars">${[1, 2, 3, 4, 5].map((n) => `
      <button type="button" role="radio" aria-checked="${value === n}" aria-label="${n} of 5"
        class="rate-star${n <= value ? ' on' : ''}" data-action="ratingSet" data-field="${name}" data-n="${n}">${n <= value ? '★' : '☆'}</button>`).join('')}</span>
  </div>`;
}

function ratingBody(){
  const r = state.rating;
  const bus = state.bus;
  if(r.step === 1) return `
    <h2 id="rateTitle">How's this bus?</h2>
    <p class="sheet-sub">${esc(bus.label || bus.registrationNo)}. One tap is enough.</p>
    ${starRow('overall', r.overall, 'Overall', true)}`;
  if(r.step === 2) return `
    <h2 id="rateTitle">${'★'.repeat(r.overall)}${'☆'.repeat(5 - r.overall)}</h2>
    <p class="sheet-sub">Anything in particular? All optional.</p>
    ${RATING_PARTS.map(([k, l]) => starRow(k, r.parts[k] || 0, l)).join('')}
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" data-action="ratingSend">Send just the stars</button>
      <button type="button" class="btn btn-primary" data-action="ratingStep" data-step="3">Next</button>
    </div>`;
  if(r.step === 3) return `
    <h2 id="rateTitle">Anything to say?</h2>
    <label for="rateComment">A review other passengers can read <span class="label-note">Optional</span></label>
    <textarea id="rateComment" maxlength="1000" rows="3" data-input="ratingText" data-field="comment">${esc(r.comment)}</textarea>
    <label for="rateSuggestion">A suggestion only the company sees <span class="label-note">Optional</span></label>
    <textarea id="rateSuggestion" maxlength="1000" rows="2" data-input="ratingText" data-field="suggestion">${esc(r.suggestion)}</textarea>
    ${r.error ? `<div class="report-error" role="alert">${esc(r.error)}</div>` : ''}
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" data-action="ratingStep" data-step="2">Back</button>
      <button type="button" class="btn btn-primary" data-action="ratingSend" ${r.sending ? 'disabled' : ''}>${r.sending ? 'Sending…' : 'Send'}</button>
    </div>
    <p class="sheet-note">Reviews are anonymous to the bus company. Batoma checks reviews that break the rules.</p>`;
  return `
    <h2 id="rateTitle">Thank you</h2>
    <p class="sheet-sub">${esc(r.result || 'Your rating has been sent.')}</p>
    <div class="btn-row">
      <a class="btn btn-ghost" href="/bus.html?id=${encodeURIComponent(bus.id)}">See this bus's ratings</a>
      <button type="button" class="btn btn-primary" data-action="ratingClose">Back to reading</button>
    </div>`;
}

function paintRating(){
  let back = document.getElementById('rateSheet');
  if(!state.rating.open){ back?.remove(); return; }
  if(!back){
    back = document.createElement('div');
    back.id = 'rateSheet';
    back.className = 'sheet-back';
    back.addEventListener('click', (e) => { if(e.target === back) closeRating(); });
    back.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeRating(); });
    document.body.appendChild(back);
  }
  back.innerHTML = `<div class="sheet rate-sheet" role="dialog" aria-modal="true" aria-labelledby="rateTitle">
    <button type="button" class="rate-x sheet-x" data-action="ratingClose" aria-label="Close">×</button>
    ${ratingBody()}</div>`;
  (back.querySelector('textarea, .rate-star:not(.on), .btn-primary') || back.querySelector('button'))?.focus();
}

/**
 * Closing after choosing stars still sends the stars: the one tap is the rating, and
 * walking away from the optional questions should not throw it away.
 */
function closeRating(){
  const r = state.rating;
  const unsent = r.overall && r.step < 4 && !r.sending;
  r.open = false;
  paintRating();
  r.returnFocus?.focus?.();
  if(unsent) sendRating(true);
}

function ratingPayload(){
  const r = state.rating;
  const body = { overall: r.overall, sessionId: state.session, scanToken: state.bus.scanToken };
  for(const [k] of RATING_PARTS) if(r.parts[k]) body[k] = r.parts[k];
  if(r.comment.trim()) body.comment = r.comment.trim();
  if(r.suggestion.trim()) body.suggestion = r.suggestion.trim();
  return body;
}

async function postRating(busId, body){
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  // A signed-in traveller is recognised too; the scan token is what proves the ride.
  return state.auth ? authed(`${API}/buses/${encodeURIComponent(busId)}/reviews`, opts)
    : fetch(`${API}/buses/${encodeURIComponent(busId)}/reviews`, opts);
}

async function sendRating(quiet){
  const r = state.rating;
  const bus = state.bus;
  if(!bus || !r.overall || r.sending) return;
  const body = ratingPayload();
  r.sending = true;
  if(!quiet) paintRating();
  try{
    const res = await postRating(bus.id, body);
    const json = await res.json().catch(() => ({}));
    if(res.ok || json?.code === 'ALREADY_REVIEWED'){
      rememberRating(bus.id, { reviewedAt: Date.now() });
      r.result = res.ok ? json.data?.message : json.message;
      r.step = 4;
    } else {
      // Refused for a reason the traveller can act on (an expired scan, say): say so.
      r.error = json?.message || 'Your rating could not be sent.';
      if(quiet) toast(r.error);
    }
  }catch(_){
    // No signal: keep it on the phone and send it when the bus is back in range.
    queueRating(bus.id, body);
    rememberRating(bus.id, { reviewedAt: Date.now() });
    r.result = 'No signal right now. Your rating is saved on this phone and goes as soon as there is.';
    r.step = 4;
  }finally{
    r.sending = false;
    if(quiet){ if(r.step === 4) toast(r.result || 'Thanks, your rating was sent.'); }
    else paintRating();
    render();
  }
}

/* ---------- offline queue ---------- */

function ratingQueue(){
  try{ return JSON.parse(localStorage.getItem('bato.ratingQueue') || '[]'); }catch(_){ return []; }
}
function queueRating(busId, body){
  const q = ratingQueue().filter((x) => x.busId !== busId);
  q.push({ busId, body, at: Date.now() });
  try{ localStorage.setItem('bato.ratingQueue', JSON.stringify(q)); }catch(_){}
}
/** Sends what was rated with no signal. A scan token lasts 12 hours, so older ones are dropped. */
async function flushRatings(){
  const q = ratingQueue();
  if(!q.length || !navigator.onLine) return;
  const keep = [];
  for(const item of q){
    if(Date.now() - item.at > RATING_RIDE_MS) continue;
    try{
      const res = await postRating(item.busId, item.body);
      if(res.ok) toast('Your saved rating has been sent. Thank you.');
    }catch(_){ keep.push(item); }
  }
  try{ localStorage.setItem('bato.ratingQueue', JSON.stringify(keep)); }catch(_){}
}

/* ---------- when to offer it ---------- */

/** A story counts as finished when its last lines have been on screen for a moment. */
let storyEndObserver = null;
function watchStoryEnd(){
  storyEndObserver?.disconnect();
  const end = document.getElementById('storyEnd');
  if(!end || !('IntersectionObserver' in window)) return;
  let timer = null;
  storyEndObserver = new IntersectionObserver(([entry]) => {
    clearTimeout(timer);
    if(entry.isIntersecting) timer = setTimeout(() => { state.finishedStory = true; }, 1200);
  }, { threshold: 1 });
  storyEndObserver.observe(end);
}

/**
 * One gentle reminder near the end of the journey, if the app is open then: the trip's
 * departure (or the scan) plus most of the route's usual journey time.
 */
let journeyEndTimer = null;
function scheduleJourneyReminder(){
  clearTimeout(journeyEndTimer);
  const hours = state.route?.typicalHours;
  if(!state.bus || !hours) return;
  const start = state.scannedAt || Date.now();
  const due = start + hours * 0.85 * 3_600_000 - Date.now();
  if(due < 0 || due > 24 * 3_600_000) return;
  journeyEndTimer = setTimeout(() => {
    if(document.hidden || !ratingAvailable() || state.rating.open) return;
    const m = ratingMemory()[state.bus.id] || {};
    if(m.reminded || (m.dismissedAt && Date.now() - m.dismissedAt < RATING_RIDE_MS)) return;
    rememberRating(state.bus.id, { reminded: Date.now() });
    showJourneyNudge();
  }, due);
}
function showJourneyNudge(){
  const nudge = document.createElement('div');
  nudge.className = 'rate-nudge';
  nudge.setAttribute('role', 'status');
  nudge.innerHTML = `<span>Nearly there? Tell us how the bus was.</span>
    <button class="btn btn-primary btn-sm" data-action="ratingOpen">Rate</button>
    <button class="rate-x" data-action="ratingNudgeClose" aria-label="Not now">×</button>`;
  document.body.appendChild(nudge);
}

/* ---------- markup actions ---------- */

Actions.on({
  ratingOpen: (el) => { document.querySelector('.rate-nudge')?.remove(); openRating(Number(el.dataset.n) || 0); },
  ratingSet: (el) => {
    const n = Number(el.dataset.n);
    if(el.dataset.field === 'overall'){ state.rating.overall = n; state.rating.step = 2; }
    else state.rating.parts[el.dataset.field] = state.rating.parts[el.dataset.field] === n ? 0 : n;
    paintRating();
  },
  ratingStep: (el) => { state.rating.step = Number(el.dataset.step); state.rating.error = ''; paintRating(); },
  ratingSend: () => sendRating(false),
  ratingClose: () => closeRating(),
  ratingSnooze: () => { rememberRating(state.bus.id, { snoozedUntil: Date.now() + RATING_SNOOZE_MS }); render(); },
  ratingDismiss: () => { rememberRating(state.bus.id, { dismissedAt: Date.now() }); render(); },
  ratingNudgeClose: () => document.querySelector('.rate-nudge')?.remove(),
});
Actions.onInput({
  ratingText: (el) => { state.rating[el.dataset.field] = el.value; },
});

window.addEventListener('online', flushRatings);
flushRatings();
