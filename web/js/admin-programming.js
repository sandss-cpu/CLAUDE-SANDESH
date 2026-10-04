/* ===========================================================================
   Route programming: what each bus shows, by route, direction, company and bus.

   A classic script loaded after admin.js, sharing its globals (state, api, esc,
   notify, askDialog, renderMain, SCREENS, Actions). Every list the editor sees is
   one "slot": a route and direction, optionally narrowed to one company or one bus,
   or the list every bus falls back to. The preview runs the server's own
   content-for, so it shows exactly what a traveller on that bus would see.

   Dates and times are entered and shown in Asia/Kathmandu (UTC+5:45 all year),
   whatever the editor's computer is set to.
   =========================================================================== */

state.prog = {
  routeId: '', direction: 'BOTH', operatorId: '', vehicleId: '',
  companies: [], list: null, preview: null, notices: [], history: [],
  at: '', panel: 'preview', results: [], scheduling: null, notice: null, assigning: null,
};

const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEVEL_LABEL = {
  VEHICLE: 'This bus', OPERATOR: 'This company', ROUTE_DIRECTION: 'Route, this way',
  ROUTE_BOTH: 'Route, both ways', DEFAULT: 'Every bus',
};
const SEVERITY_LABEL = { INFO: 'Information', WARNING: 'Warning', DANGER: 'Danger' };

const canProgramme = () => ['EDITOR', 'ADMIN'].includes(state.auth?.user?.role);

/** "2026-10-04T19:30" in Kathmandu for an <input type="datetime-local">. */
function toNptInput(iso){
  if(!iso) return '';
  return new Date(new Date(iso).getTime() + NPT_OFFSET_MS).toISOString().slice(0, 16);
}
/** The reverse: what the editor typed, read as Kathmandu time. */
function fromNptInput(value){
  return value ? new Date(`${value}:00+05:45`).toISOString() : '';
}
function fmtNpt(iso){
  if(!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function progRoute(){ return state.routes.find((r) => r.id === state.prog.routeId) || null; }

function directionLabel(d, route = progRoute()){
  if(d === 'FORWARD') return route ? `Heading to ${route.endPlace}` : 'Outbound';
  if(d === 'REVERSE') return route ? `Heading to ${route.startPlace}` : 'Return';
  return 'Both ways';
}

/** The query that names the list being edited. */
function slotQuery(extra = {}){
  const p = state.prog;
  const q = new URLSearchParams();
  if(p.routeId) q.set('routeId', p.routeId);
  if(p.routeId) q.set('direction', p.direction);
  if(p.vehicleId) q.set('vehicleId', p.vehicleId);
  else if(p.operatorId) q.set('operatorId', p.operatorId);
  for(const [k, v] of Object.entries(extra)) if(v) q.set(k, v);
  return q;
}
function slotBody(){
  return Object.fromEntries(slotQuery().entries());
}

function slotTitle(){
  const p = state.prog;
  const route = progRoute();
  if(!route) return 'Every bus — used wherever nothing more specific is programmed';
  const company = p.companies.find((c) => c.id === p.operatorId);
  const bus = company?.buses.find((b) => b.id === p.vehicleId);
  return [route.name, directionLabel(p.direction, route), bus ? `bus ${bus.plateNo}` : company ? company.name : null]
    .filter(Boolean).join(' · ');
}

function scheduleText(x){
  const parts = [];
  if(x.startsAt) parts.push(`from ${fmtNpt(x.startsAt)}`);
  if(x.endsAt) parts.push(`until ${fmtNpt(x.endsAt)}`);
  if(x.daysOfWeek?.length) parts.push(x.daysOfWeek.map((d) => DAY_NAMES[d]).join(', '));
  if(x.timeFrom) parts.push(`${x.timeFrom}–${x.timeTo}${x.timeFrom > x.timeTo ? ' (overnight)' : ''}`);
  return parts.join(' · ');
}

/* --------------------------------------------------------------- loading */

async function loadProgramme(){
  const p = state.prog;
  const tasks = [
    api(`/programming/placements?${slotQuery()}`).then((d) => { p.list = d; }),
    loadPreview(),
    api(`/programming/history?${new URLSearchParams(p.routeId ? { routeId: p.routeId } : {})}`).then((d) => { p.history = d; }),
  ];
  if(p.routeId){
    tasks.push(api(`/programming/buses?routeId=${encodeURIComponent(p.routeId)}`).then((d) => { p.companies = d; }));
    tasks.push(api(`/programming/notices?routeId=${encodeURIComponent(p.routeId)}`).then((d) => { p.notices = d; }));
  } else {
    p.companies = []; p.notices = [];
  }
  await Promise.all(tasks);
}

async function loadPreview(){
  const p = state.prog;
  const q = slotQuery({ at: p.at ? fromNptInput(p.at) : '' });
  // The preview is for a traveller, so a company narrows nothing: pick a bus to see one.
  q.delete('operatorId');
  p.preview = await api(`/programming/preview?${q}`);
}

/* --------------------------------------------------------------- screen */

async function screenProgramming(){
  const p = state.prog;
  await loadReferenceData();
  try{
    await loadProgramme();
  }catch(err){
    return `<div class="top-row"><h2>Route programming</h2></div><div class="error" role="alert">${esc(err.message)}</div>`;
  }
  const route = progRoute();
  const company = p.companies.find((c) => c.id === p.operatorId);
  return `
    <div class="top-row"><h2>Route programming</h2>
      <div class="row-actions">
        ${canProgramme() && route && p.direction !== 'BOTH' ? `<button class="btn" data-action="progCopyDirection">Copy to the return direction</button>` : ''}
        ${canProgramme() ? `<button class="btn" data-action="progOpenAssign">Put a story on several routes</button>` : ''}
      </div>
    </div>
    <p class="hint" style="margin:-8px 0 14px">What travellers read on each bus. A bus shows its own list first, then its
      company's, then its route's for the way it is going, then the route's for both ways, then the list for every bus,
      then the current issue. ${canProgramme() ? '' : '<strong>Moderators can look but not change anything here.</strong>'}</p>

    <div class="filters prog-filters">
      <label class="sr-only" for="prog-route">Route</label>
      <select id="prog-route" data-change="progSet" data-field="routeId">
        <option value="">Every bus (the fallback list)</option>
        ${state.routes.map((r) => `<option value="${esc(r.id)}" ${p.routeId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
      </select>
      ${route ? `
        <label class="sr-only" for="prog-direction">Direction</label>
        <select id="prog-direction" data-change="progSet" data-field="direction">
          ${['BOTH', 'FORWARD', 'REVERSE'].map((d) => `<option value="${d}" ${p.direction === d ? 'selected' : ''}>${esc(directionLabel(d, route))}</option>`).join('')}
        </select>
        <label class="sr-only" for="prog-company">Company</label>
        <select id="prog-company" data-change="progSet" data-field="operatorId">
          <option value="">All companies on this route</option>
          ${p.companies.map((c) => `<option value="${esc(c.id)}" ${p.operatorId === c.id ? 'selected' : ''}>${esc(c.name)}${c.verification === 'VERIFIED' ? '' : ' (not verified)'}</option>`).join('')}
        </select>
        ${company ? `
          <label class="sr-only" for="prog-bus">Bus</label>
          <select id="prog-bus" data-change="progSet" data-field="vehicleId">
            <option value="">All of ${esc(company.name)}'s buses</option>
            ${company.buses.map((b) => `<option value="${esc(b.id)}" ${p.vehicleId === b.id ? 'selected' : ''}>${esc(b.plateNo)}${b.label ? ` · ${esc(b.label)}` : ''}</option>`).join('')}
          </select>` : ''}` : ''}
    </div>

    <div class="prog-grid">
      <section class="card prog-list" aria-labelledby="prog-list-title">
        <h3 id="prog-list-title">${esc(slotTitle())}</h3>
        ${canProgramme() ? `
          <div class="prog-add">
            <label for="prog-search">Add a story</label>
            <input id="prog-search" type="search" placeholder="Search articles by title" autocomplete="off" data-input="progSearch">
            <div id="prog-results">${progResults()}</div>
          </div>` : ''}
        ${progRows()}
      </section>

      <section class="card prog-side">
        <div class="login-tabs" role="tablist" aria-label="Preview, notices and history">
          ${[['preview', 'Preview as traveller'], ['notices', `Notices${p.notices.length ? ` (${p.notices.length})` : ''}`], ['history', 'Changes']].map(([k, label]) => `
            <button role="tab" aria-selected="${p.panel === k}" class="${p.panel === k ? 'active' : ''}" data-action="progPanel" data-panel="${k}">${label}</button>`).join('')}
        </div>
        ${p.panel === 'notices' ? progNotices() : p.panel === 'history' ? progHistory() : progPreview()}
      </section>
    </div>
    ${p.scheduling ? progScheduleForm(p.scheduling) : ''}
    ${p.notice ? progNoticeForm(p.notice) : ''}
    ${p.assigning ? progAssignForm() : ''}`;
}

function progResults(){
  const p = state.prog;
  if(!p.results.length) return '';
  const inList = new Set((p.list?.items || []).map((x) => x.article.id));
  return `<ul class="prog-results">${p.results.map((a) => `
    <li><span>${esc(a.title)} ${a.status !== 'PUBLISHED' ? `<span class="pill ${esc(a.status)}">${esc(a.status.toLowerCase())}</span>` : ''}</span>
      ${inList.has(a.id)
        ? '<span class="hint">In this list</span>'
        : `<button class="btn btn-sm btn-primary" data-action="progAdd" data-id="${esc(a.id)}">Add</button>`}</li>`).join('')}</ul>`;
}

function progRows(){
  const items = state.prog.list?.items || [];
  if(!items.length) return `<div class="empty">Nothing programmed here yet. ${
    state.prog.routeId ? 'Travellers on this route see the broader lists and the current issue.' : 'Buses with no route-specific list show the current issue.'}</div>`;
  const editable = canProgramme();
  return `<ol class="prog-rows" id="prog-rows">${items.map((x, i) => `
    <li class="prog-row${x.isPinned ? ' lead' : ''}" data-id="${esc(x.id)}" ${editable && !x.isPinned ? 'draggable="true"' : ''}>
      ${editable && !x.isPinned ? '<span class="grip" aria-hidden="true">⠿</span>' : '<span class="grip" aria-hidden="true"></span>'}
      <div class="prog-what">
        <strong>${esc(x.article.title)}</strong>
        <div class="hint">
          ${x.isPinned ? '<span class="pill lead-pill">Lead story</span>' : ''}
          ${x.article.status !== 'PUBLISHED' ? `<span class="pill ${esc(x.article.status)}">Shows once published</span>` : ''}
          ${esc(x.article.category?.name || '')}${x.article.readMinutes ? ` · ${x.article.readMinutes} min` : ''}
          ${scheduleText(x) ? ` · <span class="prog-when">${esc(scheduleText(x))}</span>` : ''}
        </div>
      </div>
      ${editable ? `
        <div class="row-actions">
          ${x.isPinned ? '' : `
            <button class="btn btn-sm" data-action="progMove" data-id="${esc(x.id)}" data-by="-1" aria-label="Move up" ${i === 0 || items[i - 1].isPinned ? 'disabled' : ''}>↑</button>
            <button class="btn btn-sm" data-action="progMove" data-id="${esc(x.id)}" data-by="1" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>`}
          <button class="btn btn-sm" data-action="progPin" data-id="${esc(x.id)}" data-pin="${!x.isPinned}">${x.isPinned ? 'Unpin' : 'Make lead'}</button>
          <button class="btn btn-sm" data-action="progSchedule" data-id="${esc(x.id)}">Schedule</button>
          <button class="btn btn-sm btn-danger" data-action="progRemove" data-id="${esc(x.id)}">Remove</button>
        </div>` : ''}
    </li>`).join('')}</ol>`;
}

function progPreview(){
  const p = state.prog;
  const v = p.preview;
  const card = (x, big) => x ? `
    <li class="${big ? 'prog-lead' : ''}">
      <span class="pill level-${esc(x.level)}">${x.placementId ? esc(LEVEL_LABEL[x.level]) : 'Current issue'}</span>
      <strong>${esc(x.article.title)}</strong>
    </li>` : '';
  return `
    <div class="prog-at">
      <label for="prog-at">As of (Kathmandu time)</label>
      <input id="prog-at" type="datetime-local" value="${esc(p.at)}" data-change="progAt">
      ${p.at ? '<button class="btn btn-sm btn-ghost" data-action="progNow">Now</button>' : ''}
    </div>
    <p class="hint">${p.vehicleId ? 'Exactly what this bus shows.' : p.routeId ? 'What a bus on this route shows, before any company or bus override. Pick a bus to see one.' : 'What a bus with no route programme shows.'}
      ${p.routeId && p.direction === 'BOTH' ? ' With no direction known, only both-way stories appear.' : ''}</p>
    ${v?.notices?.length ? v.notices.map((n) => `<div class="notice-preview sev-${esc(n.severity)}"><strong>${esc(n.title)}</strong>${n.body ? `<div>${esc(n.body)}</div>` : ''}</div>`).join('') : ''}
    ${!v?.lead ? '<div class="empty">Nothing to show: no published stories reach this bus.</div>' : `
      <ol class="prog-preview">${card(v.lead, true)}${v.stories.map((x) => card(x)).join('')}</ol>
      ${v.more.length ? `<p class="hint">Plus ${v.more.length} more under “More from this issue”.</p>` : ''}`}`;
}

function progNotices(){
  const p = state.prog;
  if(!p.routeId) return '<div class="empty">Choose a route to see and post its notices.</div>';
  const now = Date.now();
  const state_ = (n) => new Date(n.startsAt) > now ? 'Scheduled' : n.endsAt && new Date(n.endsAt) <= now ? 'Ended' : 'Showing';
  return `
    ${canProgramme() ? '<button class="btn btn-primary btn-sm" data-action="progNewNotice" style="margin-bottom:10px">+ New notice</button>' : ''}
    ${!p.notices.length ? '<div class="empty">No notices on this route.</div>' : `
      <ul class="prog-notices">${p.notices.map((n) => `
        <li class="sev-${esc(n.severity)}">
          <div><span class="pill">${esc(SEVERITY_LABEL[n.severity])}</span> <span class="pill">${esc(state_(n))}</span>
            <span class="hint">${esc(directionLabel(n.direction))}</span></div>
          <strong>${esc(n.title)}</strong>${n.titleNe ? `<div lang="ne">${esc(n.titleNe)}</div>` : ''}
          <div class="hint">${esc(fmtNpt(n.startsAt))}${n.endsAt ? ` – ${esc(fmtNpt(n.endsAt))}` : ', until removed'}</div>
          ${canProgramme() ? `<div class="row-actions">
            <button class="btn btn-sm" data-action="progEditNotice" data-id="${esc(n.id)}">Edit</button>
            <button class="btn btn-sm btn-danger" data-action="progRemoveNotice" data-id="${esc(n.id)}">Remove</button></div>` : ''}
        </li>`).join('')}</ul>`}`;
}

function progHistory(){
  const items = state.prog.history;
  if(!items.length) return '<div class="empty">No changes yet.</div>';
  return `<ul class="prog-history">${items.map((e) => `
    <li><span class="hint">${esc(fmtNpt(e.createdAt))} · ${esc(e.actor?.name || 'Someone')}</span>
      <div>${esc(e.summary)}</div></li>`).join('')}</ul>`;
}

function progScheduleForm(x){
  return `
    <div class="modal-back" data-action="backdrop" data-closer="progCloseDialogs">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="prog-sched-title">
        <h2 id="prog-sched-title">When to show it</h2>
        <p class="hint">${esc(x.article.title)}. All times are Kathmandu time. Leave everything empty to show it at all times.</p>
        <form data-submit="progSaveSchedule" data-id="${esc(x.id)}">
          <div class="two-col">
            <div><label for="ps-start">From</label><input id="ps-start" name="startsAt" type="datetime-local" value="${esc(toNptInput(x.startsAt))}"></div>
            <div><label for="ps-end">Until</label><input id="ps-end" name="endsAt" type="datetime-local" value="${esc(toNptInput(x.endsAt))}"></div>
          </div>
          <fieldset class="checks"><legend>Only on these days</legend>
            ${DAY_NAMES.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${x.daysOfWeek?.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}
          </fieldset>
          <div class="two-col">
            <div><label for="ps-from">Each day from</label><input id="ps-from" name="timeFrom" type="time" value="${esc(x.timeFrom || '')}"></div>
            <div><label for="ps-to">to</label><input id="ps-to" name="timeTo" type="time" value="${esc(x.timeTo || '')}"></div>
          </div>
          <p class="hint">A window that ends earlier than it starts runs past midnight, for night buses: 22:00 to 05:00
            on a Friday covers Friday night into Saturday morning.</p>
          <div class="error" id="ps-error" role="alert" hidden></div>
          <div class="row-actions" style="justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn btn-ghost" data-action="progCloseDialogs">Cancel</button>
            <button class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>`;
}

function progNoticeForm(n){
  const route = progRoute();
  return `
    <div class="modal-back" data-action="backdrop" data-closer="progCloseDialogs">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="prog-notice-title">
        <h2 id="prog-notice-title">${n.id ? 'Edit notice' : 'New notice'} · ${esc(route?.name || '')}</h2>
        <form data-submit="progSaveNotice" data-id="${esc(n.id || '')}">
          <div class="two-col">
            <div><label for="pn-sev">How serious</label>
              <select id="pn-sev" name="severity">${Object.entries(SEVERITY_LABEL).map(([k, l]) => `<option value="${k}" ${n.severity === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label for="pn-dir">For travellers</label>
              <select id="pn-dir" name="direction">${['BOTH', 'FORWARD', 'REVERSE'].map((d) => `<option value="${d}" ${(n.direction || 'BOTH') === d ? 'selected' : ''}>${esc(directionLabel(d, route))}</option>`).join('')}</select></div>
          </div>
          <label for="pn-title">Headline</label>
          <input id="pn-title" name="title" required minlength="3" maxlength="120" value="${esc(n.title || '')}" placeholder="Landslide near Mugling: expect delays">
          <label for="pn-title-ne">Headline in Nepali</label>
          <input id="pn-title-ne" name="titleNe" lang="ne" maxlength="120" value="${esc(n.titleNe || '')}">
          <label for="pn-body">Details</label>
          <textarea id="pn-body" name="body" maxlength="600" rows="3">${esc(n.body || '')}</textarea>
          <label for="pn-body-ne">Details in Nepali</label>
          <textarea id="pn-body-ne" name="bodyNe" lang="ne" maxlength="600" rows="3">${esc(n.bodyNe || '')}</textarea>
          <div class="two-col">
            <div><label for="pn-start">Shows from (Kathmandu time)</label><input id="pn-start" name="startsAt" type="datetime-local" value="${esc(toNptInput(n.startsAt))}"></div>
            <div><label for="pn-end">Until</label><input id="pn-end" name="endsAt" type="datetime-local" value="${esc(toNptInput(n.endsAt))}"></div>
          </div>
          <p class="hint">Leave "Shows from" empty to show it now, and "Until" empty to keep it until it is removed.</p>
          <div class="error" id="pn-error" role="alert" hidden></div>
          <div class="row-actions" style="justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn btn-ghost" data-action="progCloseDialogs">Cancel</button>
            <button class="btn btn-primary">${n.id ? 'Save' : 'Post notice'}</button>
          </div>
        </form>
      </div>
    </div>`;
}

function progAssignForm(){
  const a = state.prog.assigning;
  return `
    <div class="modal-back" data-action="backdrop" data-closer="progCloseDialogs">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="prog-assign-title">
        <h2 id="prog-assign-title">Put a story on several routes</h2>
        <form data-submit="progSaveAssign">
          <label for="pa-search">Story</label>
          <input id="pa-search" type="search" placeholder="Search articles by title" autocomplete="off" data-input="progAssignSearch"
                 value="${esc(a.article?.title || '')}">
          <div id="pa-results">${progAssignResults()}</div>
          <fieldset class="checks"><legend>Routes</legend>
            ${state.routes.map((r) => `<label><input type="checkbox" name="route" value="${esc(r.id)}"> ${esc(r.name)}</label>`).join('')}
          </fieldset>
          <label for="pa-dir">Direction</label>
          <select id="pa-dir" name="direction">
            <option value="BOTH">Both ways</option><option value="FORWARD">Outbound only</option><option value="REVERSE">Return only</option>
          </select>
          <p class="hint">Routes that already carry it are left as they are.</p>
          <div class="error" id="pa-error" role="alert" hidden></div>
          <div class="row-actions" style="justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn btn-ghost" data-action="progCloseDialogs">Cancel</button>
            <button class="btn btn-primary">Add to routes</button>
          </div>
        </form>
      </div>
    </div>`;
}

function progAssignResults(){
  const a = state.prog.assigning;
  if(!a?.results?.length) return a?.article ? `<p class="hint">Chosen: <strong>${esc(a.article.title)}</strong></p>` : '';
  return `<ul class="prog-results">${a.results.map((x) => `
    <li><span>${esc(x.title)}</span><button type="button" class="btn btn-sm" data-action="progAssignPick" data-id="${esc(x.id)}">Choose</button></li>`).join('')}</ul>`;
}

/* --------------------------------------------------------------- actions */

async function progRun(work, success){
  try{
    const result = await work();
    if(success) notify(typeof success === 'function' ? success(result) : success);
  }catch(err){
    notify(err.message, 'error');
  }
  await renderMain();
}

let progSearchTimer = null;
function searchArticles(q){
  return api(`/magazine/admin/articles?${new URLSearchParams({ q, limit: '8' })}`).then((d) => d.items || []);
}

/** The order the rows are in on screen, after a drag or a move. */
function progSaveOrder(ids){
  return progRun(() => api('/programming/placements/reorder', { method: 'POST', body: { ids } }), 'New order saved');
}

function progCloseDialogs(){
  Object.assign(state.prog, { scheduling: null, notice: null, assigning: null });
  renderMain();
}
CLOSERS.progCloseDialogs = progCloseDialogs;

Actions.on({
  progPanel: (el) => { state.prog.panel = el.dataset.panel; renderMain(); },
  progNow: () => { state.prog.at = ''; renderMain(); },
  progAdd: (el) => {
    const body = { ...slotBody(), articleId: el.dataset.id };
    state.prog.results = [];
    progRun(() => api('/programming/placements', { method: 'POST', body }), 'Added to the list');
  },
  progPin: (el) => progRun(
    () => api(`/programming/placements/${el.dataset.id}`, { method: 'PATCH', body: { isPinned: el.dataset.pin === 'true' } }),
    el.dataset.pin === 'true' ? 'Now the lead story' : 'Unpinned'),
  progRemove: async (el) => {
    const x = state.prog.list.items.find((i) => i.id === el.dataset.id);
    const ok = await askDialog({ title: 'Remove from this list?', message: `“${x?.article.title}” stays in the magazine; it just stops being programmed here.`, confirmLabel: 'Remove', danger: true });
    if(ok) progRun(() => api(`/programming/placements/${el.dataset.id}`, { method: 'DELETE' }), 'Removed');
  },
  progMove: (el) => {
    const ids = state.prog.list.items.map((x) => x.id);
    const i = ids.indexOf(el.dataset.id);
    const j = i + Number(el.dataset.by);
    if(j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    progSaveOrder(ids);
  },
  progSchedule: (el) => { state.prog.scheduling = state.prog.list.items.find((x) => x.id === el.dataset.id); renderMain(); },
  progCloseDialogs: () => progCloseDialogs(),
  progCopyDirection: async () => {
    const p = state.prog;
    const other = p.direction === 'FORWARD' ? 'REVERSE' : 'FORWARD';
    const ok = await askDialog({
      title: 'Copy to the return direction?',
      message: `Stories in “${directionLabel(p.direction)}” that are not yet in “${directionLabel(other)}” are added there, with their schedules.`,
      confirmLabel: 'Copy',
    });
    if(!ok) return;
    const body = { routeId: p.routeId, from: p.direction, operatorId: p.vehicleId ? undefined : p.operatorId || undefined, vehicleId: p.vehicleId || undefined };
    progRun(() => api('/programming/copy-direction', { method: 'POST', body }),
      (r) => `${r.copied} copied${r.skipped ? `, ${r.skipped} already there` : ''}`);
  },
  progOpenAssign: () => { state.prog.assigning = { article: null, results: [] }; renderMain(); },
  progAssignPick: (el) => {
    const a = state.prog.assigning;
    a.article = a.results.find((x) => x.id === el.dataset.id) || null;
    a.results = [];
    $('#pa-search').value = a.article?.title || '';
    $('#pa-results').innerHTML = progAssignResults();
  },
  progNewNotice: () => { state.prog.notice = { direction: state.prog.direction, severity: 'WARNING' }; renderMain(); },
  progEditNotice: (el) => { state.prog.notice = { ...state.prog.notices.find((n) => n.id === el.dataset.id) }; renderMain(); },
  progRemoveNotice: async (el) => {
    const n = state.prog.notices.find((x) => x.id === el.dataset.id);
    const ok = await askDialog({ title: 'Remove this notice?', message: `“${n?.title}” stops showing at once.`, confirmLabel: 'Remove', danger: true });
    if(ok) progRun(() => api(`/programming/notices/${el.dataset.id}`, { method: 'DELETE' }), 'Notice removed');
  },
});

Actions.onChange({
  progSet: (el) => {
    const p = state.prog;
    const field = el.dataset.field;
    p[field] = el.value;
    // Narrowing resets anything narrower than what changed.
    if(field === 'routeId'){ p.operatorId = ''; p.vehicleId = ''; if(!el.value) p.direction = 'BOTH'; }
    if(field === 'operatorId') p.vehicleId = '';
    p.results = [];
    renderMain();
  },
  progAt: (el) => { state.prog.at = el.value; loadPreview().then(renderMain).catch((err) => notify(err.message, 'error')); },
});

Actions.onInput({
  // Only the results redraw, so the search box keeps focus while typing.
  progSearch: (el) => {
    clearTimeout(progSearchTimer);
    const q = el.value.trim();
    progSearchTimer = setTimeout(async () => {
      state.prog.results = q.length < 2 ? [] : await searchArticles(q).catch(() => []);
      const box = $('#prog-results'); if(box) box.innerHTML = progResults();
    }, 250);
  },
  progAssignSearch: (el) => {
    clearTimeout(progSearchTimer);
    const q = el.value.trim();
    progSearchTimer = setTimeout(async () => {
      state.prog.assigning.results = q.length < 2 ? [] : await searchArticles(q).catch(() => []);
      const box = $('#pa-results'); if(box) box.innerHTML = progAssignResults();
    }, 250);
  },
});

function formError(id, message){
  const box = document.getElementById(id);
  if(box){ box.textContent = message; box.hidden = false; }
}

Actions.onSubmit({
  progSaveSchedule: async (form, ev) => {
    ev.preventDefault();
    const f = form.elements;
    const body = {
      startsAt: fromNptInput(f.startsAt.value), endsAt: fromNptInput(f.endsAt.value),
      timeFrom: f.timeFrom.value, timeTo: f.timeTo.value,
      daysOfWeek: [...form.querySelectorAll('input[name=day]:checked')].map((c) => Number(c.value)),
    };
    try{
      await api(`/programming/placements/${form.dataset.id}`, { method: 'PATCH', body });
      state.prog.scheduling = null;
      notify('Schedule saved');
      renderMain();
    }catch(err){ formError('ps-error', err.message); }
  },
  progSaveNotice: async (form, ev) => {
    ev.preventDefault();
    const f = form.elements;
    const body = {
      routeId: state.prog.routeId, severity: f.severity.value, direction: f.direction.value,
      title: f.title.value, titleNe: f.titleNe.value, body: f.body.value, bodyNe: f.bodyNe.value,
      startsAt: fromNptInput(f.startsAt.value) || undefined, endsAt: fromNptInput(f.endsAt.value),
    };
    const id = form.dataset.id;
    try{
      await api(id ? `/programming/notices/${id}` : '/programming/notices', { method: id ? 'PATCH' : 'POST', body });
      state.prog.notice = null;
      state.prog.panel = 'notices';
      notify(id ? 'Notice saved' : 'Notice posted');
      renderMain();
    }catch(err){ formError('pn-error', err.message); }
  },
  progSaveAssign: async (form, ev) => {
    ev.preventDefault();
    const a = state.prog.assigning;
    const routeIds = [...form.querySelectorAll('input[name=route]:checked')].map((c) => c.value);
    if(!a.article) return formError('pa-error', 'Choose a story first.');
    if(!routeIds.length) return formError('pa-error', 'Choose at least one route.');
    try{
      const r = await api('/programming/assign', { method: 'POST', body: { articleId: a.article.id, routeIds, direction: form.elements.direction.value } });
      state.prog.assigning = null;
      notify(`Added to ${r.added} route${r.added === 1 ? '' : 's'}${r.skipped ? `; ${r.skipped} already had it` : ''}`);
      renderMain();
    }catch(err){ formError('pa-error', err.message); }
  },
});

/* --------------------------------------------------------------- drag to reorder */

/**
 * Rows are dragged within the list and saved once, on drop. The lead story is pinned
 * and does not move; the up and down buttons do the same job from a keyboard or a
 * touch screen, where HTML drag and drop does not work.
 */
let progDragging = null;
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('.prog-row[draggable="true"]');
  if(!row) return;
  progDragging = row;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', row.dataset.id);
});
document.addEventListener('dragover', (e) => {
  if(!progDragging) return;
  const over = e.target.closest?.('.prog-row');
  if(!over || over === progDragging || over.classList.contains('lead')) return;
  e.preventDefault();
  const box = over.getBoundingClientRect();
  over.parentNode.insertBefore(progDragging, e.clientY < box.top + box.height / 2 ? over : over.nextSibling);
});
document.addEventListener('drop', (e) => { if(progDragging) e.preventDefault(); });
document.addEventListener('dragend', () => {
  if(!progDragging) return;
  progDragging.classList.remove('dragging');
  progDragging = null;
  const ids = [...document.querySelectorAll('#prog-rows .prog-row')].map((r) => r.dataset.id);
  const before = state.prog.list.items.map((x) => x.id);
  if(ids.join() !== before.join()) progSaveOrder(ids);
});

SCREENS.programming = screenProgramming;
