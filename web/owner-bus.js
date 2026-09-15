/* Bato for bus owners: one bus, with its service history, breakdowns, documents, crew, fuel, reviews and QR code. */
'use strict';

const daysLeftText = (d) => d == null ? '' : d < 0 ? `${plural(-d, 'day')} ago` : d === 0 ? 'today' : `in ${plural(d, 'day')}`;
const thumbs = (urls) => urls?.length ? `<div class="thumbs">${urls.map((u, i) =>
  `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Photo ${i + 1}" loading="lazy"></a>`).join('')}</div>` : '';
const fail = (err) => { if(!err.silent) notify(err.message, 'error'); };

SCREENS.bus = async ({ id, tab }) => {
  if(!id){ go('buses'); return ''; }
  const bus = await api(`/fleet/buses/${encodeURIComponent(id)}`);
  state.bus = bus;
  const current = BUS_TABS[tab] ? tab : 'overview';
  const body = await BUS_TABS[current](bus);
  const tabs = [
    ['overview', 'Overview'], ['service', 'Service', bus.counts.maintenance], ['breakdowns', 'Breakdowns', bus.counts.incidents],
    ['documents', 'Documents', bus.documentsList.length], ['crew', 'Crew', bus.crew.length], ['fuel', 'Fuel', bus.counts.fuel],
    ['reviews', 'Reviews', bus.counts.reviews], ['qr', 'QR code'],
  ];
  return `
    <a class="back" href="#buses">← All buses</a>
    ${!bus.isActive ? `<div class="banner info" role="status"><span aria-hidden="true">🗄</span><div><b>This bus is archived</b>
      It is hidden from passengers and its QR code does not work. Its history is kept.</div></div>` : verificationBanner()}
    <div class="bus-hero">
      ${bus.photoUrl ? `<img src="${esc(bus.photoUrl)}" alt="Photo of ${esc(bus.label || bus.registrationNo)}">` : '<div class="noimg" aria-hidden="true">🚌</div>'}
      <div>
        <span class="plate">${esc(bus.registrationNo)}</span>
        <h1>${esc(bus.label || bus.registrationNo)}</h1>
        <div class="muted small">${esc([bus.route?.name, BUS_TYPE[bus.busType], bus.seatCount ? `${bus.seatCount} seats` : '',
          [bus.make, bus.model, bus.year].filter(Boolean).join(' ')].filter(Boolean).join(' · '))} · ${kmText(bus.odometerKm)}</div>
        <div class="pills" style="margin-top:8px">${pill(BUS_STATUS[bus.status])}${pill(SERVICE_STATE[bus.service.state])}${documentsCell(bus.documents)}
          ${bus.openIncidents ? pill([`${bus.openIncidents} open breakdown`, 'bad']) : ''}</div>
      </div>
      <div class="actions">
        ${canManage() && bus.isActive ? `<button class="btn btn-ghost btn-sm" onclick="editBus()">Edit details</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="exportCsv('${esc(bus.id)}')">Export CSV</button>
        <button class="btn btn-ghost btn-sm" onclick="printReport('${esc(bus.id)}')">Print history</button>
        ${bus.publicUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(bus.publicUrl)}" target="_blank" rel="noopener">Passenger page ↗</a>` : ''}
        ${isOwner() ? (bus.isActive
          ? `<button class="btn btn-ghost btn-sm" onclick="archiveBus(true)">Archive</button>`
          : `<button class="btn btn-brand btn-sm" onclick="archiveBus(false)">Restore</button><button class="btn btn-danger btn-sm" onclick="deleteBus()">Delete</button>`) : ''}
      </div>
    </div>
    <nav class="tabs" role="tablist" aria-label="Bus records">
      ${tabs.map(([k, label, count]) => `<a role="tab" href="#bus/${esc(bus.id)}/${k}" aria-selected="${k === current}">${label}${count != null ? `<small>${count}</small>` : ''}</a>`).join('')}
    </nav>
    <div role="tabpanel">${body}</div>`;
};

const BUS_TABS = {};

/* ================= overview ================= */

BUS_TABS.overview = async (bus) => {
  const s = bus.service;
  const driver = bus.crew.find((c) => c.role === 'DRIVER');
  return `
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Service</h2>${pill(SERVICE_STATE[s.state])}</div>
        ${s.state === 'NO_RECORD'
          ? `<p class="muted">No routine service recorded yet. Add the last service and Bato will remind you before the next one is due.</p>`
          : `<div class="facts">
              <div class="fact"><b>${fmtDay(s.lastServicedAt)}</b>Last service, at ${kmText(s.lastServiceKm)}</div>
              <div class="fact"><b>${fmtDay(s.nextDueDate)}</b>Next due by date (${daysLeftText(s.daysLeft)})</div>
              <div class="fact"><b>${kmText(s.nextDueKm)}</b>Next due by distance (${s.kmLeft < 0 ? `${num(-s.kmLeft)} km over` : `${num(s.kmLeft)} km to go`})</div>
              <div class="fact"><b>${kmText(bus.odometerKm)}</b>Current reading</div>
            </div>`}
        <p class="hint">Serviced every ${num(bus.serviceIntervalKm)} km or ${bus.serviceIntervalDays} days, whichever comes first.</p>
        ${canManage() && bus.isActive ? `<button class="btn btn-primary btn-sm" onclick="addService()">+ Add service record</button>` : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Documents</h2><a class="link" href="#bus/${esc(bus.id)}/documents">Manage</a></div>
        ${bus.documents.items.length ? bus.documents.items.map((d) => `
          <div class="crew-card"><span><b>${esc(DOC_TYPE[d.type])}</b><div class="muted small">Expires ${fmtDay(d.expiresAt)} (${daysLeftText(d.daysLeft)})</div></span>${pill(EXPIRY[d.state])}</div>`).join('')
          : empty('No documents with expiry dates. Add the bluebook, insurance and permits to get renewal reminders.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Crew on this bus</h2><a class="link" href="#bus/${esc(bus.id)}/crew">Manage</a></div>
        ${bus.crew.length ? bus.crew.map((c) => `
          <div class="crew-card"><span><b>${esc(c.name)}</b><div class="muted small">${esc(DRIVER_ROLE[c.role])} since ${fmtDay(c.since)}</div></span>
            <a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a></div>`).join('')
          : empty('No crew assigned.')}
        ${!driver && bus.isActive ? '<p class="hint">No driver assigned. Assign one so complaints can be matched to who was driving.</p>' : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Passengers</h2><a class="link" href="#bus/${esc(bus.id)}/reviews">Reviews</a></div>
        ${bus.rating.reviews ? `<div class="score"><div><div class="big">${bus.rating.average.toFixed(1)}</div><div class="stars">${stars(bus.rating.average)}</div></div>
          <div class="facts" style="flex:1"><div class="fact"><b>${bus.rating.reviews}</b>Reviews</div>
          <div class="fact"><b>${bus.rating.satisfaction ?? '—'}%</b>Satisfied</div></div></div>`
          : empty('No reviews yet. Put this bus’s QR code where passengers can see it.')}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Fuel economy</h2><a class="link" href="#bus/${esc(bus.id)}/fuel">Fuel log</a></div>
        <div class="facts">
          <div class="fact"><b>${bus.fuel.kmPerLitre ? `${bus.fuel.kmPerLitre} km/l` : '—'}</b>Mileage, last 6 months</div>
          <div class="fact"><b>${bus.fuel.costPerKm ? npr(bus.fuel.costPerKm) : '—'}</b>Fuel cost per km</div>
        </div>
        ${!bus.fuel.kmPerLitre ? '<p class="hint">Log two full-tank fill-ups with kilometre readings to see mileage.</p>' : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Recent work</h2><a class="link" href="#bus/${esc(bus.id)}/service">Full history</a></div>
        ${bus.recentService.length ? bus.recentService.map((r) => `
          <div class="crew-card"><span><b>${esc(r.title)}</b><div class="muted small">${esc(MAINT_KIND[r.kind])} · ${fmtDay(r.servicedAt)} · ${kmText(r.odometerKm)}</div></span>
            ${r.costNpr != null ? `<span class="muted small">${npr(r.costNpr)}</span>` : ''}</div>`).join('') : empty('No work recorded yet.')}
      </section>
    </div>`;
};

/* ================= edit, archive, delete ================= */

async function editBus(){
  const b = state.bus;
  const routes = await loadRoutes();
  const updated = await openForm({
    title: `Edit ${b.registrationNo}`, wide: true, submitLabel: 'Save changes',
    fields: busFields(routes, true),
    values: { ...b, routeId: b.routeId || '', busType: b.busType || '' },
    onSubmit: (v) => api(`/fleet/buses/${b.id}`, { method: 'PATCH', body: v }),
  });
  if(updated){ notify('Bus details saved.'); renderApp(); }
}

async function archiveBus(archived){
  const b = state.bus;
  const ok = await askDialog(archived ? {
    title: `Archive ${b.registrationNo}?`,
    message: 'Use this when a bus is sold or scrapped. It leaves passenger search, its QR code stops working and its crew are unassigned. Its history is kept, and you can restore it.',
    confirmLabel: 'Archive bus', danger: true,
  } : {
    title: `Restore ${b.registrationNo}?`, message: 'The bus and its QR code become active again.', confirmLabel: 'Restore bus',
  });
  if(!ok) return;
  try{
    await api(`/fleet/buses/${b.id}/archive`, { method: 'PATCH', body: { archived } });
    notify(archived ? 'Bus archived.' : 'Bus restored.');
    renderApp();
  }catch(err){ fail(err); }
}

async function deleteBus(){
  const b = state.bus;
  const done = await openForm({
    title: `Delete ${b.registrationNo} for good?`, danger: true, submitLabel: 'Delete bus and history',
    intro: 'This permanently deletes the bus with its service history, documents, fuel log, breakdowns and passenger reviews. It cannot be undone. Export the history first if you may need it.',
    fields: [{ name: 'confirm', label: `Type ${b.registrationNo} to confirm`, required: true, full: true }],
    onSubmit: async (v) => {
      const norm = (s) => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
      if(norm(v.confirm) !== norm(b.registrationNo)) throw new Error('The registration number does not match.');
      return api(`/fleet/buses/${b.id}`, { method: 'DELETE' });
    },
  });
  if(done){ notify('Bus deleted.'); go('buses'); }
}

/* ================= service history ================= */

BUS_TABS.service = async (bus) => {
  const records = await api(`/fleet/buses/${bus.id}/maintenance`);
  state.records.service = records;
  const total = records.reduce((n, r) => n + (r.costNpr || 0), 0);
  return `
    <div class="tab-head">
      <div>${pill(SERVICE_STATE[bus.service.state])}
        <span class="muted small">${bus.service.nextDueDate ? `Next service ${fmtDay(bus.service.nextDueDate)} or at ${kmText(bus.service.nextDueKm)}` : ''}
        ${total ? ` · ${npr(total)} spent in total` : ''}</span></div>
      ${canManage() && bus.isActive ? `<button class="btn btn-primary" onclick="addService()">+ Add service record</button>` : ''}
    </div>
    <section class="panel">
      ${records.length ? `<ol class="timeline">${records.map((r) => `
        <li class="tl">
          <div class="tl-date"><b>${fmtDay(r.servicedAt)}</b><span>${kmText(r.odometerKm)}</span></div>
          <div>
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <h3>${esc(r.title)}</h3>
              <div class="pills">${pill([MAINT_KIND[r.kind], r.kind === 'ROUTINE_SERVICE' ? 'info' : ''])}${r.costNpr != null ? pill([npr(r.costNpr), '']) : ''}</div>
            </div>
            ${r.workshop ? `<div class="muted small">${esc(r.workshop)}</div>` : ''}
            ${r.partsReplaced.length ? `<div class="words" style="margin-top:6px">${r.partsReplaced.map((p) => `<span class="word">🔩 ${esc(p)}</span>`).join('')}</div>` : ''}
            ${r.note ? `<p>${esc(r.note)}</p>` : ''}
            ${thumbs(r.photos)}
            ${r.nextDueDate || r.nextDueKm ? `<div class="muted small" style="margin-top:6px">Next service set for ${[r.nextDueDate && fmtDay(r.nextDueDate), r.nextDueKm && kmText(r.nextDueKm)].filter(Boolean).join(' or ')}</div>` : ''}
            ${canManage() ? `<div class="rv-actions"><button class="link" onclick="editService('${esc(r.id)}')">Edit</button>
              <button class="link" style="color:var(--rhodo)" onclick="deleteService('${esc(r.id)}')">Delete</button></div>` : ''}
          </div>
        </li>`).join('')}</ol>`
      : empty('No service history yet. Add the most recent service so Bato can remind you when the next one is due.')}
    </section>`;
};

function serviceFields(){
  return [
    { name: 'kind', label: 'Type of work', type: 'select', required: true, options: Object.entries(MAINT_KIND) },
    { name: 'servicedAt', label: 'Date', type: 'date', required: true, max: todayIso() },
    { name: 'odometerKm', label: 'Kilometre reading', type: 'number', required: true, min: 0 },
    { name: 'title', label: 'Short title', required: true, placeholder: 'e.g. Full service', maxlength: 120 },
    { name: 'workshop', label: 'Workshop', placeholder: 'e.g. Sipradi Service Centre', maxlength: 120 },
    { name: 'costNpr', label: 'Cost (NPR)', type: 'number', min: 0 },
    { name: 'partsReplaced', label: 'Parts replaced', type: 'tags', full: true, placeholder: 'e.g. Oil filter, brake pads', hint: 'Separate parts with commas.' },
    { name: 'note', label: 'Work completed', type: 'textarea', full: true, placeholder: 'What was checked, fixed or replaced', maxlength: 2000 },
    { name: 'photos', label: 'Photos of the work or replaced parts', type: 'photos', full: true, max: 10 },
    { name: 'nextDueDate', label: 'Next service date (optional)', type: 'date', hint: 'Leave empty to use the standard interval.' },
    { name: 'nextDueKm', label: 'Next service at km (optional)', type: 'number', min: 0 },
  ];
}

async function addService(){
  const b = state.bus;
  const saved = await openForm({
    title: `Add service record · ${b.registrationNo}`, wide: true, submitLabel: 'Save record',
    fields: serviceFields(),
    values: { kind: 'ROUTINE_SERVICE', servicedAt: todayIso(), odometerKm: b.odometerKm || '', title: 'Full service' },
    onSubmit: (v) => api(`/fleet/buses/${b.id}/maintenance`, { method: 'POST', body: v }),
  });
  if(saved){ notify('Service record saved.'); go(`bus/${b.id}/service`); }
}

async function editService(id){
  const r = state.records.service.find((x) => x.id === id);
  if(!r) return;
  const saved = await openForm({
    title: 'Edit service record', wide: true, submitLabel: 'Save changes', fields: serviceFields(),
    values: { ...r, servicedAt: dayIso(r.servicedAt), nextDueDate: dayIso(r.nextDueDate), costNpr: r.costNpr ?? '', nextDueKm: r.nextDueKm ?? '' },
    onSubmit: (v) => api(`/fleet/maintenance/${id}`, { method: 'PATCH', body: v }),
  });
  if(saved){ notify('Record updated.'); renderApp(); }
}

async function deleteService(id){
  const r = state.records.service.find((x) => x.id === id);
  const ok = await askDialog({ title: 'Delete this record?', message: `“${r?.title}” on ${fmtDay(r?.servicedAt)} is removed from the history.`, confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ await api(`/fleet/maintenance/${id}`, { method: 'DELETE' }); notify('Record deleted.'); renderApp(); }catch(err){ fail(err); }
}

/* ================= breakdowns ================= */

BUS_TABS.breakdowns = async (bus) => {
  const items = await api(`/fleet/buses/${bus.id}/incidents`);
  state.records.incidents = items;
  return `
    <div class="tab-head">
      <span class="muted">Breakdowns and emergency repairs on the road. Major and critical ones take the bus out of service until fixed.</span>
      ${canManage() && bus.isActive ? `<button class="btn btn-danger" onclick="reportIncident()">Report a breakdown</button>` : ''}
    </div>
    <section class="panel">
      ${items.length ? `<ol class="timeline">${items.map((i) => `
        <li class="tl">
          <div class="tl-date"><b>${fmtDay(i.occurredAt)}</b><span>${new Date(i.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span></div>
          <div>
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
              <h3>${esc(INCIDENT_KIND[i.kind])}${i.location ? ` · ${esc(i.location)}` : ''}</h3>
              <div class="pills">${pill(SEVERITY[i.severity])}${i.status === 'OPEN' ? pill(['Open', 'bad']) : pill(['Fixed', 'good'])}</div>
            </div>
            <p>${esc(i.description)}</p>
            <div class="muted small">${[i.odometerKm != null && kmText(i.odometerKm), i.driver && `Driver: ${esc(i.driver.name)}`].filter(Boolean).join(' · ')}</div>
            ${thumbs(i.photos)}
            ${i.status === 'RESOLVED' ? `<div class="reply"><b>Fixed ${fmtDateTime(i.resolvedAt)}${i.repairCostNpr != null ? ` · ${npr(i.repairCostNpr)}` : ''}</b><br>${esc(i.resolutionNote || '')}</div>`
              : canManage() ? `<div class="rv-actions"><button class="btn btn-brand btn-sm" onclick="resolveIncident('${esc(i.id)}')">Mark as fixed</button></div>` : ''}
          </div>
        </li>`).join('')}</ol>` : empty('No breakdowns recorded for this bus.')}
    </section>`;
};

async function reportIncident(){
  const b = state.bus;
  const drivers = (await loadDrivers()).filter((d) => d.isActive);
  const current = b.crew.find((c) => c.role === 'DRIVER');
  const saved = await openForm({
    title: `Report a breakdown · ${b.registrationNo}`, wide: true, submitLabel: 'Report breakdown', danger: true,
    fields: [
      { name: 'kind', label: 'What happened', type: 'select', required: true, options: Object.entries(INCIDENT_KIND) },
      { name: 'severity', label: 'Severity', type: 'select', required: true, options: Object.entries(SEVERITY).map(([k, [l]]) => [k, l]),
        hint: 'Major and critical take the bus out of service until it is marked fixed.' },
      { name: 'occurredAt', label: 'When', type: 'datetime-local', required: true, max: nowLocal() },
      { name: 'location', label: 'Where', placeholder: 'e.g. Near Malekhu', maxlength: 160 },
      { name: 'odometerKm', label: 'Kilometre reading', type: 'number', min: 0 },
      { name: 'driverId', label: 'Driver at the time', type: 'select', options: [['', 'Not recorded'], ...drivers.map((d) => [d.id, `${d.name} (${DRIVER_ROLE[d.role]})`])] },
      { name: 'description', label: 'Description', type: 'textarea', required: true, full: true, placeholder: 'What went wrong, and what is being done', maxlength: 2000 },
      { name: 'photos', label: 'Photos', type: 'photos', full: true },
    ],
    values: { kind: 'BREAKDOWN', severity: 'MAJOR', occurredAt: nowLocal(), driverId: current?.id || '' },
    onSubmit: (v) => api(`/fleet/buses/${b.id}/incidents`, { method: 'POST', body: { ...v, occurredAt: new Date(v.occurredAt).toISOString() } }),
  });
  if(saved){ notify('Breakdown reported.'); go(`bus/${b.id}/breakdowns`); }
}

async function resolveIncident(id){
  const saved = await openForm({
    title: 'Mark as fixed', submitLabel: 'Mark as fixed',
    fields: [
      { name: 'resolutionNote', label: 'How it was fixed', type: 'textarea', required: true, full: true, maxlength: 1000 },
      { name: 'repairCostNpr', label: 'Repair cost (NPR)', type: 'number', min: 0 },
      { name: 'addToServiceHistory', label: 'Also add this repair to the service history', type: 'checkbox', full: true },
    ],
    values: { addToServiceHistory: true },
    onSubmit: (v) => api(`/fleet/incidents/${id}/resolve`, { method: 'PATCH', body: v }),
  });
  if(saved){ notify('Marked as fixed.'); renderApp(); }
}

/* ================= documents ================= */

BUS_TABS.documents = async (bus) => {
  const docs = await api(`/fleet/buses/${bus.id}/documents`);
  state.records.documents = docs;
  return `
    <div class="tab-head">
      <span class="muted">Bato reminds you 30 days before a document expires, and again when it has expired.</span>
      ${canManage() && bus.isActive ? `<button class="btn btn-primary" onclick="addDocument()">+ Add document</button>` : ''}
    </div>
    <section class="panel">
      ${docs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Document</th><th>Number</th><th>Issued by</th><th>Issued</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>${docs.map((d) => `
          <tr>
            <td><b>${esc(DOC_TYPE[d.type])}</b>${d.note ? `<div class="muted small">${esc(d.note)}</div>` : ''}</td>
            <td>${esc(d.number || '—')}</td><td>${esc(d.issuer || '—')}</td><td>${fmtDay(d.issuedAt)}</td>
            <td>${fmtDay(d.expiresAt)}${d.daysLeft != null ? `<div class="muted small">${daysLeftText(d.daysLeft)}</div>` : ''}</td>
            <td>${pill(EXPIRY[d.state])}</td>
            <td class="nowrap">${d.photoUrl ? `<a class="link" href="${esc(d.photoUrl)}" target="_blank" rel="noopener">Photo</a> ` : ''}
              ${canManage() ? `<button class="link" onclick="editDocument('${esc(d.id)}')">Edit</button>
              <button class="link" style="color:var(--rhodo)" onclick="deleteDocument('${esc(d.id)}')">Delete</button>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`
      : empty('No documents yet. Add the bluebook, insurance, route permit and pollution certificate to get renewal reminders.')}
    </section>`;
};

const documentFields = () => [
  { name: 'type', label: 'Document', type: 'select', required: true, options: Object.entries(DOC_TYPE) },
  { name: 'number', label: 'Document or policy number', maxlength: 60 },
  { name: 'issuer', label: 'Issued by', placeholder: 'e.g. Nepal Insurance Co.', maxlength: 120 },
  { name: 'issuedAt', label: 'Issue date', type: 'date', max: todayIso() },
  { name: 'expiresAt', label: 'Expiry date', type: 'date', hint: 'Needed for reminders.' },
  { name: 'photoUrl', label: 'Photo of the document', type: 'photo' },
  { name: 'note', label: 'Note', type: 'textarea', full: true, maxlength: 500 },
];

async function addDocument(){
  const b = state.bus;
  const saved = await openForm({
    title: `Add document · ${b.registrationNo}`, wide: true, submitLabel: 'Save document', fields: documentFields(), values: { type: 'INSURANCE' },
    onSubmit: (v) => api(`/fleet/buses/${b.id}/documents`, { method: 'POST', body: v }),
  });
  if(saved){ notify('Document saved.'); renderApp(); }
}
async function editDocument(id){
  const d = state.records.documents.find((x) => x.id === id);
  if(!d) return;
  const saved = await openForm({
    title: `Edit ${DOC_TYPE[d.type]}`, wide: true, submitLabel: 'Save changes', fields: documentFields(),
    values: { ...d, issuedAt: dayIso(d.issuedAt), expiresAt: dayIso(d.expiresAt) },
    onSubmit: (v) => api(`/fleet/documents/${id}`, { method: 'PATCH', body: v }),
  });
  if(saved){ notify('Document updated.'); renderApp(); }
}
async function deleteDocument(id){
  const d = state.records.documents.find((x) => x.id === id);
  const ok = await askDialog({ title: `Delete ${DOC_TYPE[d?.type] || 'document'}?`, confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ await api(`/fleet/documents/${id}`, { method: 'DELETE' }); notify('Document deleted.'); renderApp(); }catch(err){ fail(err); }
}

/* ================= crew ================= */

BUS_TABS.crew = async (bus) => {
  const [crew, drivers] = await Promise.all([api(`/fleet/buses/${bus.id}/crew`), loadDrivers(true)]);
  const onBus = new Set(crew.current.map((c) => c.id));
  const available = drivers.filter((d) => d.isActive && !onBus.has(d.id));
  return `
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>On this bus now</h2></div>
        ${crew.current.length ? crew.current.map((c) => `
          <div class="crew-card">
            <span><b>${esc(c.name)}</b> ${pill([DRIVER_ROLE[c.role], 'info'])}
              <div class="muted small">Since ${fmtDay(c.since)}${c.licenceNumber ? ` · Licence ${esc(c.licenceNumber)}` : ''}</div></span>
            <span class="pills">${c.role === 'DRIVER' && c.licence.state !== 'NONE' ? pill(EXPIRY[c.licence.state]) : ''}
              <a class="btn btn-ghost btn-sm" href="tel:${esc(c.phone.replace(/\s/g, ''))}">Call</a>
              ${canManage() ? `<button class="btn btn-ghost btn-sm" onclick="unassignCrew('${esc(c.id)}')">Remove</button>` : ''}</span>
          </div>`).join('') : empty('No crew assigned to this bus.')}
        ${canManage() && bus.isActive ? `
          <form onsubmit="assignCrew(event)" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <label for="assignDriver" class="sr-only">Crew member</label>
            <select id="assignDriver" style="flex:1;min-width:200px" ${available.length ? '' : 'disabled'}>
              ${available.length ? available.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} · ${DRIVER_ROLE[d.role]}${d.buses.length ? ` (now on ${esc(d.buses[0].registrationNo)})` : ''}</option>`).join('')
                : '<option>Everyone is already on this bus</option>'}
            </select>
            <button class="btn btn-primary" type="submit" ${available.length ? '' : 'disabled'}>Assign</button>
          </form>
          <p class="hint">Assigning someone moves them off any other bus, and replaces whoever held the same job here. <a href="#crew">Add crew members</a></p>` : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>History</h2><span class="muted small">Who was on this bus, and when</span></div>
        ${crew.history.length ? `<div class="table-wrap"><table style="min-width:420px">
          <thead><tr><th>Name</th><th>Job</th><th>From</th><th>To</th></tr></thead>
          <tbody>${crew.history.map((h) => `<tr><td>${esc(h.driver.name)}</td><td>${esc(DRIVER_ROLE[h.driver.role])}</td>
            <td>${fmtDay(h.startedAt)}</td><td>${h.endedAt ? fmtDay(h.endedAt) : pill(['Current', 'good'])}</td></tr>`).join('')}</tbody></table></div>`
          : empty('No crew history yet.')}
      </section>
    </div>`;
};

async function assignCrew(e){
  e.preventDefault();
  const driverId = $('#assignDriver').value;
  try{
    await api(`/fleet/buses/${state.bus.id}/crew`, { method: 'POST', body: { driverId } });
    state.drivers = null;
    notify('Crew assigned.');
    renderApp();
  }catch(err){ fail(err); }
}
async function unassignCrew(driverId){
  try{
    await api(`/fleet/buses/${state.bus.id}/crew/${driverId}`, { method: 'DELETE' });
    state.drivers = null;
    notify('Removed from this bus.');
    renderApp();
  }catch(err){ fail(err); }
}

/* ================= fuel ================= */

BUS_TABS.fuel = async (bus) => {
  const data = await api(`/fleet/buses/${bus.id}/fuel`);
  state.records.fuel = data.logs;
  const e = data.economy;
  return `
    <div class="tab-head">
      <span class="muted">Mileage is measured between full-tank fill-ups, using the kilometre readings.</span>
      ${canManage() && bus.isActive ? `<button class="btn btn-primary" onclick="addFuel()">+ Log a fill-up</button>` : ''}
    </div>
    <div class="kpis">
      ${kpi('⛽', 'Mileage', e.kmPerLitre ? `${e.kmPerLitre} km/l` : '—', e.measuredKm ? `Over ${num(e.measuredKm)} measured km` : 'Needs two full-tank fill-ups')}
      ${kpi('₨', 'Fuel cost per km', e.costPerKm ? npr(e.costPerKm) : '—', 'Across measured stretches')}
      ${kpi('📅', 'This month', npr(data.months[data.months.length - 1].costNpr), `${num(data.months[data.months.length - 1].litres)} litres`)}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Fuel spend by month</h2></div>
        ${columns(data.months, { value: (m) => m.costNpr, label: (m) => monthShort(m.month), text: (m) => m.costNpr ? `${Math.round(m.costNpr / 1000)}k` : '0' })}
      </section>
      <section class="panel"><div class="panel-head"><h2>Mileage by stretch</h2></div>
        ${e.stretches.length ? columns(e.stretches, { value: (s) => s.kmPerLitre, label: (s) => fmtDay(s.endedAt).replace(/,? \d{4}$/, ''), text: (s) => String(s.kmPerLitre) })
          : empty('Log full-tank fill-ups to see mileage.')}
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Fill-ups</h2></div>
      ${data.logs.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Kilometres</th><th>Litres</th><th>Cost</th><th>Price / L</th><th>Tank</th><th>Station</th><th></th></tr></thead>
        <tbody>${data.logs.map((l) => `<tr>
          <td>${fmtDay(l.filledAt)}</td><td>${kmText(l.odometerKm)}</td><td>${num(l.litres)}</td><td>${npr(l.costNpr)}</td>
          <td>${l.litres ? npr(Math.round(l.costNpr / l.litres)) : '—'}</td><td>${l.fullTank ? 'Full' : 'Partial'}</td><td>${esc(l.station || '—')}</td>
          <td>${canManage() ? `<button class="link" style="color:var(--rhodo)" onclick="deleteFuel('${esc(l.id)}')">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No fill-ups logged yet.')}
    </section>`;
};

async function addFuel(){
  const b = state.bus;
  const saved = await openForm({
    title: `Log a fill-up · ${b.registrationNo}`, submitLabel: 'Save fill-up',
    fields: [
      { name: 'filledAt', label: 'Date', type: 'date', required: true, max: todayIso() },
      { name: 'odometerKm', label: 'Kilometre reading', type: 'number', required: true, min: 0 },
      { name: 'litres', label: 'Litres', type: 'number', required: true, min: 0.5, step: '0.01' },
      { name: 'costNpr', label: 'Amount paid (NPR)', type: 'number', required: true, min: 0 },
      { name: 'fullTank', label: 'Filled to a full tank', type: 'checkbox', full: true },
      { name: 'station', label: 'Fuel station', maxlength: 120 },
      { name: 'note', label: 'Note', maxlength: 300 },
    ],
    values: { filledAt: todayIso(), odometerKm: b.odometerKm || '', fullTank: true },
    onSubmit: (v) => api(`/fleet/buses/${b.id}/fuel`, { method: 'POST', body: v }),
  });
  if(saved){ notify('Fill-up saved.'); renderApp(); }
}
async function deleteFuel(id){
  const ok = await askDialog({ title: 'Delete this fill-up?', confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ await api(`/fleet/fuel/${id}`, { method: 'DELETE' }); notify('Fill-up deleted.'); renderApp(); }catch(err){ fail(err); }
}

/* ================= reviews ================= */

BUS_TABS.reviews = async (bus) => {
  const page = state.busReviewsPage || 1;
  const data = await api(`/fleet/companies/${state.companyId}/reviews?busId=${bus.id}&page=${page}`);
  const a = data.analytics;
  return `
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Rating</h2></div>
        ${satisfactionBlock({ ...a, trend: a.trend })}</section>
      <section class="panel"><div class="panel-head"><h2>Latest suggestions</h2><span class="muted small">Only you see these</span></div>
        ${a.latestSuggestions.length ? a.latestSuggestions.map((r) => `<div class="suggest">${esc(r.suggestion)}<div class="small" style="opacity:.8">${fmtDay(r.createdAt)} · ${r.overall}★</div></div>`).join('')
          : empty('No suggestions yet.')}</section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Reviews (${data.meta.total})</h2><span class="muted small">Passengers stay anonymous to you</span></div>
      ${data.items.length ? data.items.map((r) => reviewCard(r, { showBus: false })).join('') : empty('No reviews yet for this bus.')}
      ${data.meta.pages > 1 ? `<div class="pager">
        <button class="btn btn-ghost btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="state.busReviewsPage=${page - 1};renderApp()">← Newer</button>
        <span class="muted small">Page ${page} of ${data.meta.pages}</span>
        <button class="btn btn-ghost btn-sm" ${page >= data.meta.pages ? 'disabled' : ''} onclick="state.busReviewsPage=${page + 1};renderApp()">Older →</button></div>` : ''}
    </section>`;
};
window.addEventListener('hashchange', () => { state.busReviewsPage = 1; });

/* ================= QR code ================= */

BUS_TABS.qr = async (bus) => {
  const qr = await api(`/fleet/buses/${bus.id}/qr`);
  state.qr = qr;
  return qrPanel(qr, {
    heading: 'This bus’s QR code',
    about: 'Print it and stick it inside the bus where passengers can see it: on the back of seats, near the door, or by the ticket window. Scanning it opens this bus’s page, where passengers can read and leave reviews. It is one way in; passengers can also find the bus by searching its registration number.',
    rotate: canManage() && bus.isActive ? 'rotateBusQr()' : '',
    live: bus.isActive && state.company.verification === 'VERIFIED',
  });
};

function qrPanel(qr, { heading, about, rotate, live }){
  return `
    <section class="panel">
      <div class="qr-box">
        <div class="qr-img" aria-label="QR code ${esc(qr.code)}" role="img">${qr.svg}</div>
        <div>
          <h2 style="font-size:20px">${esc(heading)}</h2>
          <p class="muted">${esc(about)}</p>
          <div class="facts" style="margin:12px 0">
            <div class="fact"><b style="font-family:ui-monospace,Menlo,monospace">${esc(qr.code)}</b>Code</div>
            <div class="fact"><b>${num(qr.scans)}</b>Scans</div>
            <div class="fact"><b>${fmtDay(qr.createdAt)}</b>Created</div>
            <div class="fact"><b>${live ? pill(['Working', 'good']) : pill(['Paused', 'warn'])}</b>${live ? 'Opens for passengers' : 'Starts working once verified and active'}</div>
          </div>
          <div class="modal-actions" style="margin-top:0">
            <button class="btn btn-primary" onclick="printSticker()">Print sticker</button>
            <button class="btn btn-ghost" onclick="downloadSvg()">Download image</button>
            <button class="btn btn-ghost" onclick="copyLink()">Copy link</button>
            ${rotate ? `<button class="btn btn-ghost" onclick="${rotate}">Replace sticker</button>` : ''}
          </div>
          <p class="hint">If a sticker is damaged or copied somewhere it shouldn't be, replace it: the old code stops working at once.</p>
        </div>
      </div>
    </section>`;
}

async function rotateBusQr(){
  const ok = await askDialog({
    title: 'Replace this QR code?', danger: true, confirmLabel: 'Replace code',
    message: 'The printed sticker stops working straight away, and you will need to print and put up the new one.',
  });
  if(!ok) return;
  try{ await api(`/fleet/buses/${state.bus.id}/qr/rotate`, { method: 'POST' }); notify('New QR code created. Print the new sticker.'); renderApp(); }
  catch(err){ fail(err); }
}

function printSticker(){
  const qr = state.qr;
  const w = window.open('', '_blank');
  if(!w){ notify('Allow pop-ups for this site to print the sticker.', 'error'); return; }
  const company = state.company?.name || '';
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QR sticker · ${esc(qr.title)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:12mm;display:flex;flex-wrap:wrap;gap:8mm;justify-content:center}
      .sticker{width:88mm;border:1.5px solid #1C1A2E;border-radius:6mm;padding:5mm 6mm;text-align:center;break-inside:avoid;color:#1C1A2E}
      .brand{font:700 20px Georgia,serif;color:#5B3FA8}.flags{display:flex;height:4px;margin:2mm 0 3mm}.flags i{flex:1}
      .cta{font-weight:700;font-size:17px;margin:0}.ne{font-size:14px;margin:1mm 0 2mm}
      .qr svg{width:64mm;height:64mm;display:block;margin:0 auto}
      .plate{display:inline-block;font:700 15px monospace;border:1.5px solid #000;border-radius:4px;padding:1px 8px;margin-top:2mm}
      .sub{font-size:12px;margin-top:1mm}.code{font:11px monospace;color:#555;margin-top:2mm}
      @media print{body{padding:0}@page{margin:10mm}}
    </style></head><body>
    ${[1, 2].map(() => `<div class="sticker">
      <div class="brand">Bato</div>
      <div class="flags"><i style="background:#2F6FD0"></i><i style="background:#eee"></i><i style="background:#E8455F"></i><i style="background:#3E9B4F"></i><i style="background:#F4A024"></i></div>
      <p class="cta">How was your ride? Scan to rate this bus</p>
      <p class="ne">यो बसको समीक्षा गर्न स्क्यान गर्नुहोस्</p>
      <div class="qr">${qr.svg}</div>
      <div class="plate">${esc(qr.title)}</div>
      <div class="sub">${esc([qr.subtitle, company].filter(Boolean).join(' · '))}</div>
      <div class="code">Code ${esc(qr.code)}</div>
    </div>`).join('')}
    <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

function downloadSvg(){
  const qr = state.qr;
  const url = URL.createObjectURL(new Blob([qr.svg], { type: 'image/svg+xml' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `bato-qr-${qr.title.replace(/[^\p{L}\p{N}]+/gu, '-')}.svg` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyLink(){
  try{ await navigator.clipboard.writeText(state.qr.url); notify('Link copied.'); }
  catch(_){ await askDialog({ title: 'Link for this QR code', field: { label: 'Link', value: state.qr.url }, confirmLabel: 'Done' }); }
}
