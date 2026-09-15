/* Bato for bus owners: onboarding, dashboard, reminders, bus list and bus registration. */
'use strict';

/* ================= onboarding ================= */

SCREENS.onboard = async () => {
  const again = state.companies.length > 0;
  return `
    <div class="onboard">
      ${pageHead(again ? 'Register another company' : `Welcome, ${esc(state.auth?.user?.name || '')}`,
        again ? 'Each company has its own buses, crew and team.' : 'Start by telling Bato about your company. An individual owner with one bus registers the same way.')}
      <form class="panel" onsubmit="registerCompany(event)" novalidate>
        <div class="form-grid" style="margin-top:0">
          ${fieldHtml({ name: 'name', label: 'Company or owner name', required: true, full: true, placeholder: 'e.g. Himalayan Express Travels', maxlength: 120 })}
          ${fieldHtml({ name: 'contactPhone', label: 'Contact phone', type: 'tel', required: true, placeholder: '98XXXXXXXX' })}
          ${fieldHtml({ name: 'contactEmail', label: 'Contact email', type: 'email', placeholder: 'office@example.com' })}
          ${fieldHtml({ name: 'registrationNo', label: 'Company registration or PAN number', hint: 'Optional, but it helps Bato verify you faster.', maxlength: 40 })}
          ${fieldHtml({ name: 'address', label: 'Office address', placeholder: 'e.g. Gongabu Bus Park, Kathmandu', maxlength: 200 })}
          ${fieldHtml({ name: 'description', label: 'About your service', type: 'textarea', full: true, placeholder: 'Routes you run and the kind of buses', maxlength: 1000 })}
        </div>
        <div class="error" id="onboardError" role="alert" hidden></div>
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit">Register company</button>
          ${again ? `<button class="btn btn-ghost" type="button" onclick="selectCompany(state.companies[0].id)">Cancel</button>` : `<button class="btn btn-ghost" type="button" onclick="signOut()">Sign out</button>`}
        </div>
      </form>
      <div class="panel">
        <h2 style="font-size:17px;margin-bottom:6px">What happens next</h2>
        <ol class="muted" style="margin:0;padding-left:20px">
          <li>Add your buses by registration number. Each one gets its own QR code straight away.</li>
          <li>Bato checks your company, usually within two working days.</li>
          <li>Once verified, passengers can find your buses, scan the QR codes and leave reviews.</li>
        </ol>
      </div>
    </div>`;
};

async function registerCompany(e){
  e.preventDefault();
  const form = e.target;
  const box = $('#onboardError');
  const v = Object.fromEntries(['name', 'contactPhone', 'contactEmail', 'registrationNo', 'address', 'description']
    .map((k) => [k, form.elements[k].value.trim()]));
  const problem = v.name.length < 2 ? 'Enter the company or owner name.'
    : !/^\+?[0-9][0-9\s-]{6,19}$/.test(v.contactPhone) ? 'Enter a contact phone number.'
    : v.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail) ? 'Enter a valid contact email, or leave it empty.' : '';
  if(problem){ box.textContent = problem; box.hidden = false; return; }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = 'Registering…';
  try{
    const created = await api('/fleet/companies', { method: 'POST', body: v });
    state.companies = await api('/fleet/companies');
    notify(`${created.name} is registered. Add your first bus.`);
    await selectCompany(created.id);
  }catch(err){
    if(err.silent) return;
    box.textContent = err.message; box.hidden = false;
    button.disabled = false; button.textContent = 'Register company';
  }
}

/* ================= shared pieces ================= */

function reminderTarget(r){
  if(r.kind.startsWith('LICENCE')) return 'crew';
  if(!r.busId) return 'dashboard';
  const tab = r.kind.startsWith('SERVICE') ? 'service' : r.kind.startsWith('DOCUMENT') ? 'documents' : r.kind.startsWith('INCIDENT') ? 'breakdowns' : 'overview';
  return `bus/${r.busId}/${tab}`;
}

function reminderList(items, emptyText = 'Nothing needs attention. Every bus is serviced and every document is valid.'){
  if(!items.length) return empty(emptyText);
  return items.map((r) => `
    <button class="rem" onclick="go('${esc(reminderTarget(r))}')">
      <span class="dot ${r.severity}" aria-label="${r.severity === 'high' ? 'Urgent' : r.severity === 'medium' ? 'Soon' : 'To do'}"></span>
      <span><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></span>
    </button>`).join('');
}

function reviewCard(r, { showBus = true } = {}){
  state.records.reviews = state.records.reviews || {};
  state.records.reviews[r.id] = r;
  const parts = PARTS.filter(([k]) => r[k]).map(([k, l]) => `${l} ${r[k]}`).join(' · ');
  const moderation = r.moderation === 'PENDING' ? pill(['Held for a moderator', 'warn'])
    : r.moderation === 'REJECTED' ? pill(['Hidden by Bato', 'bad']) : '';
  return `
    <article class="review">
      <div class="rv-top">
        <span class="stars" aria-label="${r.overall} out of 5">${stars(r.overall)}</span>
        ${r.verifiedRide ? pill(['Scanned on board', 'good']) : pill(['Passenger', ''])}
        ${moderation}
        <span class="muted">${fmtDay(r.createdAt)}${r.tripDate ? ` · travelled ${fmtDay(r.tripDate)}` : ''}</span>
      </div>
      ${showBus && r.bus ? `<a class="rv-bus" href="#bus/${esc(r.bus.id)}/reviews"><span class="plate">${esc(r.bus.registrationNo)}</span>${esc(r.bus.label || '')}</a>` : ''}
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      ${parts ? `<div class="muted small" style="margin-top:4px">${esc(parts)}</div>` : ''}
      ${r.suggestion ? `<div class="suggest"><b>Suggestion (only you see this):</b> ${esc(r.suggestion)}</div>` : ''}
      ${r.ownerReply ? `<div class="reply"><b>Your public reply</b> · ${fmtDay(r.ownerRepliedAt)}<br>${esc(r.ownerReply)}</div>` : ''}
      <div class="rv-actions">
        ${canManage() ? `<button class="link" onclick="replyReview('${esc(r.id)}')">${r.ownerReply ? 'Edit reply' : 'Reply'}</button>` : ''}
        <button class="link" onclick="reportReview('${esc(r.id)}')">Report to Bato</button>
      </div>
    </article>`;
}

function satisfactionBlock(s){
  if(!s.reviews) return empty('No reviews yet. Print the QR codes and put them inside your buses so passengers can rate them.');
  return `
    <div class="score">
      <div><div class="big">${s.average.toFixed(1)}</div><div class="stars" aria-label="${s.average} out of 5">${stars(s.average)}</div>
        <div class="muted small">${plural(s.reviews, 'review')}${s.satisfiedPercent != null ? ` · ${s.satisfiedPercent}% satisfied` : ''}</div></div>
      <div style="flex:1;min-width:200px">${distribution(s.distribution)}</div>
    </div>
    ${partsGrid(s.parts)}
    ${s.trend?.length ? `<h3 style="font-size:14px;margin:14px 0 0;font-family:var(--font-body)">Average rating by month</h3>
      ${columns(s.trend, { value: (t) => t.average, max: 5, label: (t) => monthShort(t.month), text: (t) => t.average.toFixed(1) })}` : ''}`;
}

function serviceCell(s){
  const p = pill(SERVICE_STATE[s.state]);
  if(s.state === 'NO_RECORD') return p;
  const detail = s.state === 'OVERDUE'
    ? (s.daysLeft < 0 ? `${plural(-s.daysLeft, 'day')} late` : `${num(-s.kmLeft)} km over`)
    : `in ${plural(Math.max(0, s.daysLeft), 'day')} / ${num(Math.max(0, s.kmLeft))} km`;
  return `${p}<div class="muted small">${detail}</div>`;
}
function documentsCell(d){
  if(d.expired) return pill([`${d.expired} expired`, 'bad']);
  if(d.expiring) return pill([`${d.expiring} expiring`, 'warn']);
  return d.items.length ? pill(['All valid', 'good']) : pill(['None added', '']);
}
function ratingCell(r){
  return r.reviews ? `<span class="stars">${stars(r.average)}</span> ${r.average.toFixed(1)}<div class="muted small">${plural(r.reviews, 'review')}</div>` : '<span class="muted">No reviews</span>';
}

function performanceTable(rows){
  if(!rows.length) return empty('No buses yet.');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Bus</th><th>Status</th><th>Rating</th><th>Satisfied</th><th>Service</th><th>Documents</th><th>Breakdowns</th><th>Fuel</th><th>Driver</th></tr></thead>
    <tbody>${rows.map((b) => `
      <tr class="row-link" onclick="go('bus/${esc(b.id)}')">
        <td><a href="#bus/${esc(b.id)}" onclick="event.stopPropagation()"><span class="plate">${esc(b.registrationNo)}</span></a><div class="small">${esc(b.label || '')}</div></td>
        <td>${pill(BUS_STATUS[b.status])}</td>
        <td>${ratingCell(b.rating)}</td>
        <td>${b.rating.satisfaction != null ? `${b.rating.satisfaction}%` : '—'}</td>
        <td>${serviceCell(b.service)}</td>
        <td>${documentsCell(b.documents)}</td>
        <td>${b.openIncidents ? pill([`${b.openIncidents} open`, 'bad']) : '<span class="muted">None open</span>'}</td>
        <td>${b.fuel.kmPerLitre ? `${b.fuel.kmPerLitre} km/l` : '—'}</td>
        <td>${esc(b.crew.find((c) => c.role === 'DRIVER')?.name || '—')}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

/* ================= dashboard ================= */

SCREENS.dashboard = async () => {
  const d = await api(`/fleet/companies/${state.companyId}/dashboard`);
  state.unread = d.totals.unreadNotifications;
  state.company = { ...state.company, ...d.company };
  renderShell();
  const t = d.totals;
  const s = d.satisfaction;
  const attention = t.serviceOverdue + t.documentsExpired + t.openIncidents;
  return `
    ${pageHead('Dashboard', `${esc(d.company.name)} · ${fmtDay(new Date())}`,
      canManage() ? `<button class="btn btn-primary" onclick="newBus()">+ Register a bus</button>` : '')}
    ${verificationBanner()}
    ${!t.buses ? `<div class="panel" style="text-align:center;padding:30px">
        <div style="font-size:40px" aria-hidden="true">🚌</div><h2>Register your first bus</h2>
        <p class="muted">Add it by its registration number. Bato creates its QR code and starts tracking service, documents and reviews.</p>
        ${canManage() ? '<button class="btn btn-primary" onclick="newBus()">+ Register a bus</button>' : ''}</div>` : ''}
    <div class="kpis">
      ${kpi('🚌', 'Buses registered', t.buses, `${t.byStatus.ACTIVE} on the road · ${t.byStatus.IN_MAINTENANCE} in maintenance · ${t.byStatus.OFF_ROAD} off road`, "go('buses')")}
      ${kpi('★', 'Passenger rating', s.average != null ? s.average.toFixed(1) : '—', s.reviews ? `${plural(s.reviews, 'review')} · ${s.last30Reviews} in the last 30 days` : 'No reviews yet', "go('feedback')")}
      ${kpi('😊', 'Satisfied passengers', s.satisfiedPercent != null ? `${s.satisfiedPercent}%` : '—', 'Rated their ride 4 or 5 stars', "go('feedback')")}
      ${kpi('⚠', 'Needs attention', attention, `${t.serviceOverdue} overdue service · ${t.documentsExpired} expired documents · ${t.openIncidents} open breakdowns`, "go('reminders')", attention ? 'alert' : '')}
      ${kpi('🔧', 'Due soon', t.serviceDueSoon + t.documentsExpiring, `${plural(t.serviceDueSoon, 'service')} · ${plural(t.documentsExpiring, 'document')} expiring within 30 days`, "go('reminders')")}
      ${kpi('⛽', 'Fuel, last 30 days', npr(d.fuel.last30CostNpr), `${num(d.fuel.last30Litres)} L${d.fuel.fleetKmPerLitre ? ` · ${d.fuel.fleetKmPerLitre} km/l average` : ''}`)}
      ${kpi('👤', 'Drivers', t.drivers, `${t.crew} crew in total · ${plural(t.busesWithoutDriver, 'bus', 'buses')} without a driver`, "go('crew')")}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Reminders</h2><a class="link" href="#reminders">See all (${d.reminders.length})</a></div>
        ${reminderList(d.reminders.slice(0, 7))}</section>
      <section class="panel"><div class="panel-head"><h2>Customer satisfaction</h2><a class="link" href="#feedback">Full feedback</a></div>
        ${satisfactionBlock(s)}</section>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Latest reviews</h2><a class="link" href="#feedback">All reviews</a></div>
        ${d.recentReviews.length ? d.recentReviews.slice(0, 4).map((r) => reviewCard(r)).join('') : empty('No reviews yet.')}</section>
      <section class="panel"><div class="panel-head"><h2>Open breakdowns</h2></div>
        ${d.openIncidents.length ? d.openIncidents.map((i) => `
          <button class="rem" onclick="go('bus/${esc(i.bus.id)}/breakdowns')">
            <span class="dot ${i.severity === 'MINOR' ? 'medium' : 'high'}"></span>
            <span><b>${esc(INCIDENT_KIND[i.kind])} · ${esc(i.bus.plateNo)}</b>
              <span>${esc(i.description)}${i.location ? ` · ${esc(i.location)}` : ''} · ${fmtDateTime(i.occurredAt)}</span></span>
          </button>`).join('') : empty('No open breakdowns.')}</section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Bus performance</h2><span class="muted small">Buses needing attention first</span></div>
      ${performanceTable(d.buses)}</section>`;
};

/* ================= reminders ================= */

SCREENS.reminders = async () => {
  const [d, n] = await Promise.all([
    api(`/fleet/companies/${state.companyId}/dashboard`),
    api(`/fleet/companies/${state.companyId}/notifications`),
  ]);
  state.unread = n.unread;
  renderShell();
  return `
    ${pageHead('Reminders', 'What needs doing across your fleet, and updates from Bato.',
      n.unread ? `<button class="btn btn-ghost" onclick="markAllRead()">Mark all as read</button>` : '')}
    ${verificationBanner()}
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Needs attention (${d.reminders.length})</h2></div>
        ${reminderList(d.reminders)}
        <p class="hint">Company members with a confirmed email also get one summary email each morning at 6:00 when something new comes up.</p>
      </section>
      <section class="panel"><div class="panel-head"><h2>Updates</h2>${n.unread ? `<span class="pill info">${n.unread} unread</span>` : ''}</div>
        ${n.items.length ? n.items.map((x) => `
          <button class="rem" onclick="go('${x.vehicle ? `bus/${esc(x.vehicle.id)}` : 'dashboard'}')">
            <span class="dot ${x.readAt ? '' : 'high'}" aria-label="${x.readAt ? 'Read' : 'Unread'}"></span>
            <span><b style="${x.readAt ? 'font-weight:600' : ''}">${esc(x.title)}</b><span>${esc(x.body)} · ${fmtDateTime(x.createdAt)}</span></span>
          </button>`).join('') : empty('No updates yet.')}
      </section>
    </div>`;
};

async function markAllRead(){
  try{
    await api(`/fleet/companies/${state.companyId}/notifications/read`, { method: 'POST' });
    state.unread = 0;
    notify('All updates marked as read.');
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/* ================= buses ================= */

SCREENS.buses = async () => {
  const f = state.buses;
  const qs = new URLSearchParams({ page: String(f.page) });
  if(f.q) qs.set('q', f.q);
  if(f.status) qs.set('status', f.status);
  if(f.archived) qs.set('archived', 'true');
  const data = await api(`/fleet/companies/${state.companyId}/buses?${qs}`);
  return `
    ${pageHead('Buses', `${plural(data.meta.total, f.archived ? 'archived bus' : 'bus', f.archived ? 'archived buses' : 'buses')}${f.q || f.status ? ' match' : ''}`,
      canManage() ? `<button class="btn btn-primary" onclick="newBus()">+ Register a bus</button>` : '')}
    ${verificationBanner()}
    <form class="filters" role="search" onsubmit="event.preventDefault(); filterBuses({ q: this.elements.q.value.trim() })">
      <input name="q" type="search" placeholder="Search by registration number or bus name" value="${esc(f.q)}" aria-label="Search buses">
      <select aria-label="Status" onchange="filterBuses({ status: this.value })">
        <option value="">All statuses</option>
        ${Object.entries(BUS_STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="check"><input type="checkbox" ${f.archived ? 'checked' : ''} onchange="filterBuses({ archived: this.checked })"> Archived</label>
      <button class="btn btn-ghost" type="submit">Search</button>
    </form>
    ${data.items.length ? `<div class="bus-grid">${data.items.map(busCard).join('')}</div>`
      : empty(f.q || f.status || f.archived ? 'No buses match.' : 'No buses yet. Register your first bus by its registration number.')}
    ${data.meta.pages > 1 ? `<div class="pager">
      <button class="btn btn-ghost btn-sm" ${data.meta.page <= 1 ? 'disabled' : ''} onclick="filterBuses({ page: ${data.meta.page - 1} }, true)">← Previous</button>
      <span class="muted small">Page ${data.meta.page} of ${data.meta.pages}</span>
      <button class="btn btn-ghost btn-sm" ${data.meta.page >= data.meta.pages ? 'disabled' : ''} onclick="filterBuses({ page: ${data.meta.page + 1} }, true)">Next →</button></div>` : ''}`;
};

function filterBuses(patch, keepPage){
  Object.assign(state.buses, patch);
  if(!keepPage) state.buses.page = 1;
  renderApp();
}

function busCard(b){
  const driver = b.crew.find((c) => c.role === 'DRIVER');
  return `
    <a class="bus-card" href="#bus/${esc(b.id)}">
      ${b.photoUrl ? `<img src="${esc(b.photoUrl)}" alt="" loading="lazy">` : '<div class="noimg" aria-hidden="true">🚌</div>'}
      <div class="bc-body">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span class="plate">${esc(b.registrationNo)}</span>${pill(BUS_STATUS[b.status])}</div>
        <h3>${esc(b.label || b.registrationNo)}</h3>
        <div class="bc-meta">${esc([b.route?.name, BUS_TYPE[b.busType], b.seatCount ? `${b.seatCount} seats` : ''].filter(Boolean).join(' · ') || 'No route set')}</div>
        <div class="pills">${pill(SERVICE_STATE[b.service.state])}${documentsCell(b.documents)}${b.openIncidents ? pill([`${b.openIncidents} breakdown`, 'bad']) : ''}</div>
        <div class="bc-meta">${b.rating.reviews ? `<span class="stars">${stars(b.rating.average)}</span> ${b.rating.average.toFixed(1)} (${b.rating.reviews})` : 'No reviews yet'}
          · ${kmText(b.odometerKm)}${driver ? ` · ${esc(driver.name)}` : ''}</div>
      </div>
    </a>`;
}

function busFields(routes, isEdit){
  return [
    { name: 'registrationNo', label: 'Registration number', required: true, placeholder: 'e.g. BA 1 KHA 2345', maxlength: 30,
      hint: 'As written on the number plate. A bus can only be registered on Bato once.' },
    { name: 'label', label: 'Bus name', placeholder: 'e.g. Everest Deluxe 01', maxlength: 60 },
    { name: 'busType', label: 'Type', type: 'select', options: [['', 'Choose a type'], ...Object.entries(BUS_TYPE)] },
    { name: 'seatCount', label: 'Seats', type: 'number', min: 1, max: 120 },
    { name: 'routeId', label: 'Usual route', type: 'select', options: [['', 'No fixed route'], ...routes.map((r) => [r.id, r.name])] },
    { name: 'status', label: 'Status', type: 'select', options: Object.entries(BUS_STATUS).map(([k, [l]]) => [k, l]) },
    { name: 'make', label: 'Make', placeholder: 'e.g. Tata', maxlength: 40 },
    { name: 'model', label: 'Model', placeholder: 'e.g. Starbus Ultra', maxlength: 40 },
    { name: 'year', label: 'Year made', type: 'number', min: 1970, max: 2100 },
    { name: 'colour', label: 'Colour', maxlength: 30 },
    { name: 'odometerKm', label: 'Current kilometre reading', type: 'number', min: 0,
      hint: isEdit ? 'Updates automatically from service and fuel records.' : '' },
    { name: 'serviceIntervalKm', label: 'Service every (km)', type: 'number', min: 500, max: 100000, hint: 'Most buses: 10,000 km' },
    { name: 'serviceIntervalDays', label: 'Or every (days)', type: 'number', min: 7, max: 730, hint: 'Whichever comes first' },
    { name: 'amenities', label: 'Facilities on board', type: 'chips', full: true, options: Object.entries(AMENITY) },
    { name: 'photoUrl', label: 'Photo of the bus', type: 'photo', full: true },
  ];
}

async function newBus(){
  const routes = await loadRoutes();
  const created = await openForm({
    title: 'Register a bus', wide: true, submitLabel: 'Register bus',
    intro: 'A QR code for this bus is created automatically. Passengers see the bus once your company is verified.',
    fields: busFields(routes),
    values: { status: 'ACTIVE', serviceIntervalKm: 10000, serviceIntervalDays: 90, amenities: [] },
    onSubmit: (v) => api(`/fleet/companies/${state.companyId}/buses`, { method: 'POST', body: v }),
  });
  if(created && created.id){
    notify(`${created.registrationNo} is registered. Its QR code is ready.`);
    go(`bus/${created.id}`);
  }
}
