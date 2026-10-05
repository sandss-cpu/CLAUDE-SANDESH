/* Batoma reader: the reading experience (Feature 4).

   Briefer stories (an "In brief" box, long bodies folded behind "Continue reading", a
   contents list for stories with three or more subheadings), a reading-progress bar,
   a "Next" bar at 70%, a large "Up next" at the end, "Continue where you left off",
   a labelled "Keep reading" rail, and the stops on this road as a timeline in travel
   order.

   Loaded before reader.js: these functions use its state and helpers, and only run
   once it has set them up. */
'use strict';

const FOLD_WORDS = 600;   // stories longer than this fold...
const FOLD_AT = 280;      // ...after about this many words
const READ_POS_KEY = 'bato.readPos';
const motionOk = () => document.documentElement.dataset.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- story text ---------- */

/** The markdown editors write, as blocks: ## and ### headings and paragraphs. Text is escaped before any markup goes in. */
function mdBlocks(text){
  const blocks = [];
  let n = 0;
  for(const chunk of String(text || '').split(/\n{2,}/)){
    const lines = chunk.trim().split('\n');
    while(lines.length && /^#{2,3}\s+\S/.test(lines[0])){
      const [, hashes, title] = /^(#{2,3})\s+(.+)$/.exec(lines.shift());
      n += 1;
      blocks.push({ type: hashes.length === 2 ? 'h2' : 'h3', text: title.trim(), id: `sec-${n}`, words: 0 });
    }
    const t = lines.join('\n').trim();
    if(t) blocks.push({ type: 'p', text: t, words: t.split(/\s+/).length });
  }
  return blocks;
}
const inlineMd = (t) => esc(t)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // *Naubise, first hour.* — single asterisks are the editors' italics.
  .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
  .replace(/\n/g, '<br>');
const renderBlocks = (blocks) => blocks.map((b) => (b.type === 'p'
  ? `<p>${inlineMd(b.text)}</p>`
  : `<${b.type} id="${b.id}" tabindex="-1">${esc(b.text)}</${b.type}>`)).join('');

/** Where a long story folds: after the paragraph that passes FOLD_AT words, or -1 for a short one. */
function foldPoint(blocks){
  const total = blocks.reduce((n, b) => n + b.words, 0);
  if(total <= FOLD_WORDS) return -1;
  let words = 0;
  for(let i = 0; i < blocks.length; i++){
    words += blocks[i].words;
    if(words >= FOLD_AT && blocks[i].type === 'p' && i < blocks.length - 1) return i + 1;
  }
  return -1;
}

function inBrief(a){
  const points = (a.keyPoints || []).filter(Boolean);
  if(!points.length && !a.summary) return '';
  return `<aside class="in-brief" aria-labelledby="inBriefTitle">
    <h2 id="inBriefTitle">In brief</h2>
    ${points.length ? `<ul>${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : `<p>${esc(a.summary)}</p>`}
    <div class="meta"><span>${a.readMinutes || 3} min read</span>${a.audioUrl ? '<span>🎧 Narrated</span>' : ''}</div>
  </aside>`;
}

function contentsList(blocks){
  const heads = blocks.filter((b) => b.type !== 'p');
  if(heads.length < 3) return '';
  return `<nav class="toc" aria-labelledby="tocTitle"><h2 id="tocTitle">In this story</h2>
    <ul>${heads.map((h) => `<li class="${h.type}"><button class="link-btn" data-action="tocJump" data-id="${h.id}">${esc(h.text)}</button></li>`).join('')}</ul></nav>`;
}

/** The story's body, folded if long; the end-of-story options follow the fold, so they come sooner. */
function articleBodyHtml(a){
  const blocks = mdBlocks(a.body);
  const fold = a.unfolded ? -1 : foldPoint(blocks);
  if(fold < 0) return { blocks, html: `<div class="article-body">${renderBlocks(blocks)}</div>`, folded: false };
  const shownWords = blocks.slice(0, fold).reduce((n, b) => n + b.words, 0);
  const totalWords = blocks.reduce((n, b) => n + b.words, 0);
  const minutesLeft = Math.max(1, Math.round((a.readMinutes || 3) * (1 - shownWords / totalWords)));
  return {
    blocks, folded: true,
    html: `<div class="article-body folded">${renderBlocks(blocks.slice(0, fold))}</div>
      <button class="btn btn-primary continue-reading" data-action="unfoldStory">Continue reading · ${minutesLeft} min more</button>`,
  };
}

/** The next story in this bus's programme, and two related ones: the same section first. */
function upNextFor(current){
  const list = [...articles(), ...(isDemo() ? [] : state.more)].filter((a, i, all) => all.findIndex((x) => x.slug === a.slug) === i);
  const at = list.findIndex((a) => a.slug === current.slug);
  const pool = [...list.slice(at + 1), ...list.slice(0, Math.max(0, at))].filter((a) => a.slug !== current.slug);
  const next = pool[0] || null;
  const rest = pool.slice(1);
  const related = [...rest.filter((a) => a.cat === current.cat), ...rest.filter((a) => a.cat !== current.cat)].slice(0, 2);
  return { next, related };
}

function upNextSection(current){
  const { next, related } = upNextFor(current);
  if(!next) return '';
  return `<section class="up-next" aria-labelledby="upNextTitle">
    <div class="sec-head"><h2 id="upNextTitle">Up next</h2><span>${state.route ? esc(state.route.name) : 'From this issue'}</span></div>
    <button class="card up-next-card" data-action="openArticle" data-slug="${esc(next.slug)}">
      <div class="card-art" style="background:${CAT_ART[next.cat] || CAT_ART.road}"><span class="tag c-${esc(next.cat)}">${esc(next.catName)}</span></div>
      <div class="card-body">
        <h3>${esc(next.title)}</h3>
        ${next.summary ? `<p class="one-line">${esc(next.summary)}</p>` : ''}
        <div class="meta"><span>${next.readMinutes || 3} min read</span>${next.audio ? '<span class="listen">🎧 Listen</span>' : ''}<span class="go">Read it →</span></div>
      </div>
    </button>
    ${related.length ? `<div class="sec-head"><h2 style="font-size:18px">Also on this road</h2><span></span></div>${related.map(listCard).join('')}` : ''}
    <button class="btn btn-ghost" style="margin-top:6px" data-action="go" data-to="read">All stories</button>
  </section>`;
}

/** The story screen's reading aids: progress along the top, and "Next" once 70% is read. */
function readingChrome(a){
  const { next } = upNextFor(a);
  return `<div class="read-progress" aria-hidden="true"><i id="readProg"></i></div>
    ${next ? `<div class="next-bar" id="nextBar" hidden>
      <button class="next-go" data-action="openArticle" data-slug="${esc(next.slug)}"><span>Next:</span> ${esc(next.title)} →</button>
      <button class="next-x" data-action="dismissNextBar" aria-label="Hide the next story bar">×</button>
    </div>` : ''}`;
}

/* ---------- where each story was left ---------- */

function readPositions(){
  try{ return JSON.parse(localStorage.getItem(READ_POS_KEY) || '{}'); }catch(_){ return {}; }
}
function saveReadPosition(a, pct){
  try{
    const all = readPositions();
    all[a.slug] = {
      pct: Math.round(pct * 1000) / 1000, y: Math.round(scrollY), unfolded: !!a.unfolded,
      title: a.title, cat: a.cat, catName: a.catName, at: Date.now(), finished: pct >= 0.95 || !!all[a.slug]?.finished,
    };
    // The twenty most recent stories are enough to pick one up again.
    const keep = Object.entries(all).sort((x, y) => y[1].at - x[1].at).slice(0, 20);
    localStorage.setItem(READ_POS_KEY, JSON.stringify(Object.fromEntries(keep)));
  }catch(_){ /* private mode: nothing to remember */ }
}

/** The story most recently left part-read, this week, if there is one. */
function storyToResume(){
  if(state.continueDismissed) return null;
  const known = new Set([...articles(), ...(isDemo() ? [] : state.more)].map((a) => a.slug));
  const [slug, p] = Object.entries(readPositions())
    // Opened and left at once is not "left part-read": the reader must have scrolled into it.
    .filter(([s, x]) => !x.finished && x.pct >= 0.15 && x.y > 50 && x.pct < 0.95 && Date.now() - x.at < 7 * 86_400_000 && (known.has(s) || x.title))
    .sort((x, y) => y[1].at - x[1].at)[0] || [];
  return slug ? { slug, ...p } : null;
}

function continueCard(){
  const r = storyToResume();
  if(!r) return '';
  return `<div class="continue-card">
    <button class="continue-go" data-action="resumeArticle" data-slug="${esc(r.slug)}">
      <span class="continue-label">Continue where you left off</span>
      <strong>${esc(r.title)}</strong>
      <span class="continue-bar" aria-hidden="true"><i style="width:${Math.round(r.pct * 100)}%"></i></span>
      <span class="small">${Math.round(r.pct * 100)}% read</span>
    </button>
    <button class="continue-x" data-action="dismissContinue" aria-label="Not now">×</button>
  </div>`;
}

let readScrollPending = false;
let saveTimer = null;
/** Progress, the Next bar and the saved place, on scroll; one frame at a time. */
function onReadScroll(){
  const a = state.article;
  if(state.screen !== 'article' || !a || a.loading || a.error) return;
  const body = document.querySelector('.article-body');
  if(!body) return;
  const rect = body.getBoundingClientRect();
  let pct = Math.max(0, Math.min(1, (innerHeight - rect.top) / Math.max(1, rect.height)));
  // A folded story is only partly on the page: progress is measured against the whole.
  if(body.classList.contains('folded')){
    const blocks = mdBlocks(a.body);
    const fold = foldPoint(blocks);
    const shown = blocks.slice(0, fold).reduce((n, b) => n + b.words, 0);
    pct *= shown / Math.max(1, blocks.reduce((n, b) => n + b.words, 0));
  }
  const bar = document.getElementById('readProg');
  if(bar) bar.style.width = `${Math.round(pct * 100)}%`;
  const next = document.getElementById('nextBar');
  if(next) next.hidden = !(pct >= 0.7 && !a.nextDismissed);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveReadPosition(a, pct), 700);
}
window.addEventListener('scroll', () => {
  if(readScrollPending) return;
  readScrollPending = true;
  requestAnimationFrame(() => { readScrollPending = false; onReadScroll(); });
}, { passive: true });

/** After the story screen is drawn: back to where the reader was, if they asked to resume. */
function afterArticleRender(){
  // The Next bar sits just above the bottom navigation, whatever height the phone gives it.
  const nav = document.getElementById('nav');
  if(nav) document.documentElement.style.setProperty('--nav-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
  const a = state.article;
  if(!a || a.loading) return;
  if(a.resumeTo != null){
    const y = a.resumeTo;
    a.resumeTo = null;
    // After the screen change has scrolled to the top, back to where the reader stopped.
    setTimeout(() => { window.scrollTo({ top: y, behavior: 'auto' }); onReadScroll(); }, 0);
  }
  onReadScroll();
}

async function resumeArticle(slug){
  const saved = readPositions()[slug];
  await openArticle(slug);
  const a = state.article;
  if(!a || a.slug !== slug || a.error) return;
  if(saved?.unfolded) a.unfolded = true;
  a.resumeTo = saved?.y ?? null;
  render();
}

function unfoldStory(){
  const a = state.article;
  if(!a) return;
  const y = scrollY;
  a.unfolded = true;
  render();
  window.scrollTo({ top: y, behavior: 'auto' });
  // Keyboard and screen reader users carry on from the paragraph after the fold.
  const paras = document.querySelectorAll('.article-body > p, .article-body > h2, .article-body > h3');
  const first = paras[foldPoint(mdBlocks(a.body))] || null;
  if(first){ first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
}

function tocJump(id){
  const a = state.article;
  if(a && !a.unfolded && !document.getElementById(id)){ a.unfolded = true; render(); }
  const el = document.getElementById(id);
  if(!el) return;
  el.scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto', block: 'start' });
  el.focus({ preventScroll: true });
}

/* ---------- the read screen ---------- */

function keepReadingRail(items){
  if(!items.length) return '';
  return `<section class="rail-section" aria-labelledby="keepTitle">
    <div class="sec-head"><h2 id="keepTitle">Keep reading</h2>
      <span class="rail-tools">
        <button class="rail-arrow" data-action="railScroll" data-dir="-1" aria-label="Previous stories">‹</button>
        <button class="rail-arrow" data-action="railScroll" data-dir="1" aria-label="More stories">›</button>
        <button class="see-all" data-action="seeAllStories">See all</button>
      </span></div>
    <div class="rail" id="keepRail" tabindex="0" role="group" aria-label="More stories, side by side">${items.map(railCard).join('')}</div>
  </section>`;
}

function railScroll(dir){
  const rail = document.getElementById('keepRail');
  if(rail) rail.scrollBy({ left: dir * rail.clientWidth * 0.85, behavior: motionOk() ? 'smooth' : 'auto' });
}

function allStoriesView(){
  const list = [...articles(), ...(isDemo() ? [] : state.more)].filter((a, i, all) => all.findIndex((x) => x.slug === a.slug) === i);
  return `<button class="chip" data-action="closeAllStories" style="margin:14px 0 4px">← Back</button>
    <div class="sec-head"><h2>All stories</h2><span>${list.length} ${list.length === 1 ? 'story' : 'stories'}</span></div>
    ${list.map(listCard).join('')}`;
}

/* ---------- stops on this road ---------- */

function etaText(s){
  if(s.inMinutes != null){
    const m = Math.round(s.inMinutes);
    if(m <= 5) return 'about now';
    return m < 60 ? `in about ${m} min` : `in about ${Math.floor(m / 60)} h${m % 60 >= 10 ? ` ${Math.round(m % 60 / 5) * 5} min` : ''}`;
  }
  return s.minutesFromStart != null ? timeFromStart(s.minutesFromStart) : '';
}

function stopRow(s){
  const wa = Stops.whatsappUrl(s.whatsapp);
  const dirUrl = Stops.directionsUrl(s);
  const facts = [s.type, s.km != null ? `${s.km} km` : '', etaText(s), s.price || ''].filter(Boolean);
  return `<li class="road-stop ${s.highlight ? 'highlight' : ''}">
    <span class="stop-dot" aria-hidden="true">${s.icon}</span>
    <div class="stop-main">
      <div class="stop-title">
        ${s.slug ? `<button class="link-btn" data-action="openBiz" data-slug="${esc(s.slug)}">${esc(s.name)}</button>` : `<span>${esc(s.name)}</span>`}
        ${s.verified ? '<span class="badge-v">✓ Verified</span>' : ''}
        ${s.paid ? '<span class="paid-label" title="This business pays to be listed on this road">Promoted</span>' : ''}
      </div>
      <div class="stop-facts">${facts.map(esc).join(' · ')}</div>
      ${s.hours.state !== 'unknown' ? `<div class="hours ${s.hours.state}">${esc(s.hours.label)}</div>` : ''}
      ${s.phone || wa || dirUrl ? `<div class="stop-actions">
        ${s.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">📞 Call</a>` : ''}
        ${wa ? `<a class="btn btn-ghost btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${dirUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(dirUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}
      </div>` : ''}
    </div>
  </li>`;
}

/**
 * This road's stops as a timeline in travel order, for the direction the bus is going:
 * coming up, later, at the destination, and listed businesses with no place on the guide.
 * Four are shown; "See all" opens the full road guide. Works offline: the guide is saved
 * when it is first fetched, and the listed businesses come with the scan.
 */
function stopsSection(){
  if(isDemo()){
    const stops = DEMO.businesses;
    return stops.length ? `<div class="sec-head"><h2>Stops on this road</h2><span>${stops.length} along the way</span></div>${stops.map((b) => bizRow(b)).join('')}` : '';
  }
  const r = state.route;
  if(!r) return '';
  const dir = currentDirection();
  const road = dir ? loadRoad() : null;
  const since = state.departedAt || state.scannedAt || null;
  const t = Stops.buildTimeline({
    stops: road?.guide?.stops || [], businesses: state.biz.items || [], route: r, direction: dir,
    minutesElapsed: since ? Math.max(0, Math.round((Date.now() - since) / 60000)) : null,
    now: new Date(), filter: state.stopsFilter || '',
  });
  const head = `<div class="sec-head"><h2 id="stopsTitle">Stops on this road</h2>
    <span>${dir ? `Heading to ${esc(t.destination)}` : esc(r.name)}</span></div>`;
  if(!dir && !t.total) return '';
  const filters = `<div class="chips stop-filters" role="group" aria-label="Show stops for">
    <button class="chip" aria-pressed="${!state.stopsFilter}" data-action="setStopsFilter" data-filter="">All</button>
    ${Stops.FILTERS.map(([k, l]) => `<button class="chip" aria-pressed="${state.stopsFilter === k}" data-action="setStopsFilter" data-filter="${k}">${esc(l)}</button>`).join('')}
  </div>`;
  const groups = [
    ['Coming up', t.comingUp], ['Later on the road', t.later], [`At ${t.destination}`, t.atDestination], ['Along this road', t.alongTheRoad],
  ].filter(([, list]) => list.length);
  let left = state.stopsAll ? Infinity : 4;
  const shownGroups = [];
  for(const [title, list] of groups){
    if(left <= 0) break;
    shownGroups.push([title, list.slice(0, left)]);
    left -= list.length;
  }
  const loadingGuide = dir && road?.loading;
  return `<section class="stops" aria-labelledby="stopsTitle">
    ${head}
    ${!dir ? `<p class="hint-line">Tap where your bus is heading, at the top, to see the stops in the order you pass them.</p>` : ''}
    ${filters}
    ${loadingGuide ? '<div class="skel" style="height:96px;margin:8px 0"></div>' : ''}
    ${shownGroups.map(([title, list]) => `<h3 class="stop-group">${esc(title)}</h3><ol class="timeline">${list.map(stopRow).join('')}</ol>`).join('')}
    ${!t.total && !loadingGuide ? `<div class="empty"><p>No stops of that kind on this road${state.stopsFilter ? '' : ' yet'}.</p></div>` : ''}
    ${t.passed ? `<p class="hint-line">${t.passed} ${t.passed === 1 ? 'stop is' : 'stops are'} already behind you.</p>` : ''}
    ${t.total > 4 && !state.stopsAll ? `<button class="btn btn-ghost" data-action="go" data-to="map">See all ${t.total} stops</button>` : ''}
  </section>`;
}

Actions.on({
  unfoldStory: () => unfoldStory(),
  tocJump: (el) => tocJump(el.dataset.id),
  dismissNextBar: () => { if(state.article) state.article.nextDismissed = true; const b = document.getElementById('nextBar'); if(b) b.hidden = true; },
  resumeArticle: (el) => resumeArticle(el.dataset.slug),
  dismissContinue: () => { state.continueDismissed = true; render(); },
  railScroll: (el) => railScroll(Number(el.dataset.dir)),
  seeAllStories: () => { state.readAll = true; render(); window.scrollTo(0, 0); },
  closeAllStories: () => { state.readAll = false; render(); },
  setStopsFilter: (el) => { state.stopsFilter = el.dataset.filter || ''; render(); document.getElementById('stopsTitle')?.scrollIntoView({ block: 'start' }); },
});
