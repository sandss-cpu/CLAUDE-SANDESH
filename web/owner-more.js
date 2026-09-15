/* Bato for bus owners: feedback analytics, crew, company and team, and history exports. */
'use strict';

/* ================= feedback ================= */

SCREENS.feedback = async () => {
  const f = state.feedback;
  const qs = new URLSearchParams({ page: String(f.page) });
  if(f.busId) qs.set('busId', f.busId);
  if(f.rating) qs.set('rating', f.rating);
  if(f.days) qs.set('days', f.days);
  const data = await api(`/fleet/companies/${state.companyId}/reviews?${qs}`);
  const a = data.analytics;
  // The bus filter lists every bus with reviews; remember it from an unfiltered load.
  if(!f.busId) state.feedbackBuses = a.byBus;
  const busOptions = state.feedbackBuses || a.byBus;

  return `
    ${pageHead('Customer feedback', 'Ratings, reviews and suggestions from passengers. Reviewers are anonymous to you.')}
    <div class="filters">
      <select aria-label="Bus" onchange="filterFeedback({ busId: this.value })">
        <option value="">All buses</option>
        ${busOptions.map((b) => `<option value="${esc(b.busId)}" ${f.busId === b.busId ? 'selected' : ''}>${esc(b.registrationNo)}${b.label ? ` · ${esc(b.label)}` : ''}</option>`).join('')}
      </select>
      <select aria-label="Period" onchange="filterFeedback({ days: this.value })">
        ${[['', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last year']].map(([v, l]) => `<option value="${v}" ${String(f.days) === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select aria-label="Stars" onchange="filterFeedback({ rating: this.value })">
        <option value="">Any rating</option>
        ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${String(f.rating) === String(n) ? 'selected' : ''}>${n} star${n === 1 ? '' : 's'}</option>`).join('')}
      </select>
    </div>
    <div class="kpis">
      ${kpi('★', 'Average rating', a.average != null ? a.average.toFixed(1) : '—', a.reviews ? `${plural(a.reviews, 'review')}` : 'No reviews in this view')}
      ${kpi('😊', 'Satisfied', a.satisfiedPercent != null ? `${a.satisfiedPercent}%` : '—', 'Rated 4 or 5 stars')}
      ${PARTS.map(([k, l]) => kpi('', l, a.parts[k] != null ? a.parts[k].toFixed(1) : '—', 'out of 5')).join('')}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>Ratings</h2></div>
        ${a.reviews ? distribution(a.distribution) : empty('No reviews in this view.')}
        ${a.trend.length ? `<h3 style="font-size:14px;margin:14px 0 0;font-family:var(--font-body)">Average by month</h3>
          ${columns(a.trend, { value: (t) => t.average, max: 5, label: (t) => monthShort(t.month), text: (t) => t.average.toFixed(1) })}` : ''}
      </section>
      <section class="panel"><div class="panel-head"><h2>By bus</h2><span class="muted small">Lowest rated first</span></div>
        ${a.byBus.length ? `<div class="table-wrap"><table style="min-width:360px">
          <thead><tr><th>Bus</th><th>Rating</th><th>Reviews</th></tr></thead>
          <tbody>${a.byBus.map((b) => `<tr class="row-link" onclick="go('bus/${esc(b.busId)}/reviews')">
            <td><span class="plate">${esc(b.registrationNo)}</span> <span class="small">${esc(b.label || '')}</span></td>
            <td><span class="stars">${stars(b.average)}</span> ${b.average.toFixed(1)}</td><td>${b.reviews}</td></tr>`).join('')}</tbody></table></div>`
          : empty('No reviews yet.')}
      </section>
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>What passengers praise</h2><span class="muted small">From 4 and 5 star reviews</span></div>
        ${a.praise.length ? `<div class="words">${a.praise.map((w) => `<span class="word">${esc(w.word)}<b>${w.count}</b></span>`).join('')}</div>` : empty('Not enough reviews yet.')}
        <div class="panel-head" style="margin-top:16px"><h2>What they complain about</h2><span class="muted small">From 1 and 2 star reviews</span></div>
        ${a.complaints.length ? `<div class="words">${a.complaints.map((w) => `<span class="word">${esc(w.word)}<b>${w.count}</b></span>`).join('')}</div>` : empty('No repeated complaints.')}
      </section>
      <section class="panel"><div class="panel-head"><h2>Latest suggestions</h2><span class="muted small">Only your company sees these</span></div>
        ${a.latestSuggestions.length ? a.latestSuggestions.map((r) => `<div class="suggest">${esc(r.suggestion)}
          <div class="small" style="opacity:.85">${r.bus ? `${esc(r.bus.registrationNo)} · ` : ''}${fmtDay(r.createdAt)} · ${r.overall}★</div></div>`).join('') : empty('No suggestions yet.')}
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Reviews (${data.meta.total})</h2><span class="muted small">Newest first</span></div>
      ${data.items.length ? data.items.map((r) => reviewCard(r)).join('') : empty('No reviews match.')}
      ${data.meta.pages > 1 ? `<div class="pager">
        <button class="btn btn-ghost btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="filterFeedback({ page: ${f.page - 1} }, true)">← Newer</button>
        <span class="muted small">Page ${f.page} of ${data.meta.pages}</span>
        <button class="btn btn-ghost btn-sm" ${f.page >= data.meta.pages ? 'disabled' : ''} onclick="filterFeedback({ page: ${f.page + 1} }, true)">Older →</button></div>` : ''}
    </section>`;
};

function filterFeedback(patch, keepPage){
  Object.assign(state.feedback, patch);
  if(!keepPage) state.feedback.page = 1;
  renderApp();
}

async function replyReview(id){
  const r = state.records.reviews?.[id];
  if(!r) return;
  const reply = await askDialog({
    title: r.ownerReply ? 'Edit your reply' : 'Reply to this review',
    message: 'Your reply appears under the review on the bus’s public page. Keep it polite: thank the passenger and say what you are doing about it. Leave it empty to remove the reply.',
    confirmLabel: 'Save reply',
    field: { type: 'textarea', label: 'Reply', value: r.ownerReply || '', maxlength: 1000, rows: 5 },
  });
  if(reply === null) return;
  try{
    await api(`/fleet/reviews/${id}/reply`, { method: 'POST', body: { reply } });
    notify(reply ? 'Reply published.' : 'Reply removed.');
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function reportReview(id){
  const done = await openForm({
    title: 'Report this review to Bato', submitLabel: 'Send report',
    intro: 'You can’t delete reviews yourself. A Bato moderator will check this one and remove it if it breaks the rules, for example if it is fake, abusive or about a different bus.',
    fields: [
      { name: 'reason', label: 'Reason', type: 'select', required: true, full: true, options: [['', 'Choose a reason'], ...REPORT_REASONS] },
      { name: 'detail', label: 'Details for the moderator', type: 'textarea', full: true, maxlength: 1000 },
    ],
    onSubmit: (v) => {
      if(!v.reason) throw new Error('Choose a reason.');
      return api(`/fleet/reviews/${id}/report`, { method: 'POST', body: v });
    },
  });
  if(done) notify(done.duplicate ? 'You have already reported this review.' : 'Report sent. A moderator will take a look.');
}

/* ================= crew ================= */

SCREENS.crew = async () => {
  const drivers = await loadDrivers(true);
  state.records.drivers = drivers;
  const active = drivers.filter((d) => d.isActive);
  const licenceIssues = active.filter((d) => ['EXPIRED', 'EXPIRING'].includes(d.licence.state)).length;
  return `
    ${pageHead('Crew', `${plural(active.length, 'active crew member')}${licenceIssues ? ` · ${plural(licenceIssues, 'licence')} need renewing` : ''}`,
      canManage() ? `<button class="btn btn-primary" onclick="addDriver()">+ Add crew member</button>` : '')}
    <section class="panel">
      ${drivers.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Job</th><th>Phone</th><th>Licence</th><th>Bus</th><th>Breakdowns</th><th>Status</th><th></th></tr></thead>
        <tbody>${drivers.map((d) => `<tr>
          <td><b>${esc(d.name)}</b>${d.note ? `<div class="muted small">${esc(d.note)}</div>` : ''}</td>
          <td>${esc(DRIVER_ROLE[d.role])}</td>
          <td><a href="tel:${esc(d.phone.replace(/\s/g, ''))}">${esc(d.phone)}</a></td>
          <td>${d.licenceNumber ? esc(d.licenceNumber) : '<span class="muted">—</span>'}
            ${d.licence.state !== 'NONE' ? `<div>${pill(EXPIRY[d.licence.state])} <span class="muted small">${fmtDay(d.licenceExpiresAt)}</span></div>` : ''}</td>
          <td>${d.buses.length ? d.buses.map((b) => `<a href="#bus/${esc(b.id)}/crew"><span class="plate">${esc(b.registrationNo)}</span></a>`).join(' ') : '<span class="muted">Not assigned</span>'}</td>
          <td>${d.incidents || '—'}</td>
          <td>${d.isActive ? pill(['Active', 'good']) : pill(['Inactive', ''])}</td>
          <td>${canManage() ? `<button class="link" onclick="editDriver('${esc(d.id)}')">Edit</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`
        : empty('No crew yet. Add your drivers and conductors, then assign them to buses.')}
    </section>
    <p class="hint">Bato reminds you 30 days before a driving licence expires. Assign crew to a bus from that bus’s Crew tab.</p>`;
};

const driverFields = (isEdit) => [
  { name: 'name', label: 'Full name', required: true, maxlength: 80 },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, placeholder: '98XXXXXXXX' },
  { name: 'role', label: 'Job', type: 'select', options: Object.entries(DRIVER_ROLE) },
  { name: 'licenceNumber', label: 'Driving licence number', maxlength: 40 },
  { name: 'licenceExpiresAt', label: 'Licence expiry date', type: 'date' },
  { name: 'photoUrl', label: 'Photo', type: 'photo' },
  { name: 'note', label: 'Note', type: 'textarea', full: true, maxlength: 500 },
  ...(isEdit ? [{ name: 'isActive', label: 'Still working for the company', type: 'checkbox', full: true, hint: 'Unticking removes them from their bus.' }] : []),
];

async function addDriver(){
  const saved = await openForm({
    title: 'Add crew member', wide: true, submitLabel: 'Add', fields: driverFields(false), values: { role: 'DRIVER' },
    onSubmit: (v) => api(`/fleet/companies/${state.companyId}/drivers`, { method: 'POST', body: v }),
  });
  if(saved){ state.drivers = null; notify(`${saved.name} added.`); renderApp(); }
}

async function editDriver(id){
  const d = state.records.drivers.find((x) => x.id === id);
  if(!d) return;
  const saved = await openForm({
    title: `Edit ${d.name}`, wide: true, submitLabel: 'Save changes', fields: driverFields(true),
    values: { ...d, licenceExpiresAt: dayIso(d.licenceExpiresAt) },
    onSubmit: (v) => api(`/fleet/drivers/${id}`, { method: 'PATCH', body: v }),
  });
  if(saved){ state.drivers = null; notify('Crew member updated.'); renderApp(); }
}

/* ================= company ================= */

SCREENS.company = async () => {
  const [company, qr] = await Promise.all([
    api(`/fleet/companies/${state.companyId}`),
    api(`/fleet/companies/${state.companyId}/qr`),
  ]);
  state.company = company;
  state.qr = qr;
  renderShell();
  const me = state.auth?.user?.id;
  const owners = company.members.filter((m) => m.role === 'OWNER').length;
  const detail = (label, value) => `<div class="fact"><b style="font-size:15px">${value ? esc(value) : '<span class="muted">—</span>'}</b>${label}</div>`;
  return `
    ${pageHead('Company', esc(company.name), isOwner() ? `<button class="btn btn-ghost" onclick="editCompany()">Edit details</button>` : '')}
    ${verificationBanner()}
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Details</h2>${pill(VERIFICATION[company.verification])}</div>
        <div class="facts">
          ${detail('Name', company.name)}${detail('Registration or PAN', company.registrationNo)}
          ${detail('Phone', company.contactPhone)}${detail('Email', company.contactEmail)}
          ${detail('Address', company.address)}${detail('Registered on Bato', fmtDay(company.createdAt))}
        </div>
        ${company.description ? `<p style="margin-top:12px">${esc(company.description)}</p>` : ''}
        ${company.verifiedAt ? `<p class="hint">Verified by Bato on ${fmtDay(company.verifiedAt)}.</p>` : ''}
        ${!isOwner() ? '<p class="hint">Only an owner can change company details.</p>' : ''}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Team</h2>${isOwner() ? `<button class="btn btn-primary btn-sm" onclick="addMember()">+ Add member</button>` : ''}</div>
        ${company.members.map((m) => `
          <div class="crew-card">
            <span><b>${esc(m.name)}</b>${m.userId === me ? ' <span class="muted small">(you)</span>' : ''}
              <div class="muted small">${esc(m.email || '')} · since ${fmtDay(m.since)}</div></span>
            <span class="pills">${pill([m.role === 'OWNER' ? 'Owner' : 'Manager', m.role === 'OWNER' ? 'info' : ''])}
              ${(isOwner() && m.userId !== me) || (m.userId === me && !(m.role === 'OWNER' && owners <= 1))
                ? `<button class="btn btn-ghost btn-sm" onclick="removeMember('${esc(m.userId)}')">${m.userId === me ? 'Leave' : 'Remove'}</button>` : ''}</span>
          </div>`).join('')}
        <p class="hint"><b>Owners</b> manage everything, including company details, the team and deleting buses.
          <b>Managers</b> handle buses, service, documents, crew, fuel, breakdowns and review replies.</p>
      </section>
    </div>
    ${qrPanel(qr, {
      heading: 'Company QR code',
      about: 'Put this one at your ticket counter, office or bus park. Scanning it lists all your buses, so passengers can pick the one they rode and review it.',
      rotate: canManage() ? 'rotateCompanyQr()' : '',
      live: company.verification === 'VERIFIED',
    })}`;
};

async function editCompany(){
  const c = state.company;
  const saved = await openForm({
    title: 'Edit company details', wide: true, submitLabel: 'Save changes',
    intro: c.verification === 'VERIFIED'
      ? 'Changing the company name or registration number means Bato checks your company again, and your buses are hidden from passengers until then.'
      : c.verification === 'REJECTED' ? 'Saving sends your company to Bato to be checked again.' : '',
    fields: [
      { name: 'name', label: 'Company or owner name', required: true, full: true, maxlength: 120 },
      { name: 'contactPhone', label: 'Contact phone', type: 'tel', required: true },
      { name: 'contactEmail', label: 'Contact email', type: 'email' },
      { name: 'registrationNo', label: 'Registration or PAN number', maxlength: 40 },
      { name: 'address', label: 'Office address', maxlength: 200 },
      { name: 'description', label: 'About your service', type: 'textarea', full: true, maxlength: 1000 },
      { name: 'logoUrl', label: 'Logo', type: 'photo', full: true },
    ],
    values: c,
    onSubmit: (v) => api(`/fleet/companies/${c.id}`, { method: 'PATCH', body: v }),
  });
  if(saved){
    state.companies = await api('/fleet/companies');
    notify(saved.verification === 'PENDING' && c.verification !== 'PENDING' ? 'Saved. Bato will check your company again.' : 'Company details saved.');
    renderApp();
  }
}

async function addMember(){
  const saved = await openForm({
    title: 'Add a team member', submitLabel: 'Add to team',
    intro: 'They need a Bato account with a confirmed email first. Ask them to create one at this page, then enter the same email here.',
    fields: [
      { name: 'email', label: 'Their email', type: 'email', required: true, full: true },
      { name: 'role', label: 'Role', type: 'select', full: true, options: [['MANAGER', 'Manager: day-to-day records and replies'], ['OWNER', 'Owner: everything, including the team']] },
    ],
    values: { role: 'MANAGER' },
    onSubmit: (v) => api(`/fleet/companies/${state.companyId}/members`, { method: 'POST', body: v }),
  });
  if(saved){ notify('Team member added.'); renderApp(); }
}

async function removeMember(userId){
  const me = state.auth?.user?.id;
  const m = state.company.members.find((x) => x.userId === userId);
  const self = userId === me;
  const ok = await askDialog({
    title: self ? `Leave ${state.company.name}?` : `Remove ${m?.name}?`,
    message: self ? 'You will lose access to this company’s buses and records.' : 'They will lose access to this company straight away.',
    confirmLabel: self ? 'Leave company' : 'Remove', danger: true,
  });
  if(!ok) return;
  try{
    await api(`/fleet/companies/${state.companyId}/members/${userId}`, { method: 'DELETE' });
    if(self){ localStorage.removeItem(COMPANY_KEY); notify('You have left the company.'); await bootApp(); return; }
    notify('Removed from the team.');
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function rotateCompanyQr(){
  const ok = await askDialog({
    title: 'Replace the company QR code?', danger: true, confirmLabel: 'Replace code',
    message: 'Printed company codes stop working straight away. Bus QR codes are not affected.',
  });
  if(!ok) return;
  try{ await api(`/fleet/companies/${state.companyId}/qr/rotate`, { method: 'POST' }); notify('New company QR code created.'); renderApp(); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/* ================= history export ================= */

/** Spreadsheet apps run cells that start with = + - @ as formulas; prefix them so exported text stays text. */
function csvCell(v){
  if(v == null) return '';
  let s = String(v);
  if(typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(busId){
  try{
    const h = await api(`/fleet/buses/${busId}/history`);
    const rows = [
      ['Bato bus service history'],
      ['Company', h.company.name], ['Registration number', h.bus.registrationNo], ['Bus name', h.bus.label],
      ['Type', BUS_TYPE[h.bus.busType] || ''], ['Kilometre reading', h.bus.odometerKm], ['Exported', new Date(h.generatedAt).toLocaleString()],
      [],
      ['SERVICE AND REPAIRS'],
      ['Date', 'Type', 'Kilometres', 'Title', 'Workshop', 'Cost (NPR)', 'Parts replaced', 'Work completed', 'Next due date', 'Next due km', 'Photos'],
      ...h.maintenance.map((m) => [dayIso(m.servicedAt), MAINT_KIND[m.kind], m.odometerKm, m.title, m.workshop, m.costNpr,
        m.partsReplaced.join('; '), m.note, dayIso(m.nextDueDate), m.nextDueKm, m.photos.join(' ')]),
      [],
      ['BREAKDOWNS AND EMERGENCY REPAIRS'],
      ['Occurred', 'Type', 'Severity', 'Status', 'Location', 'Kilometres', 'Driver', 'Description', 'Fixed', 'How it was fixed', 'Repair cost (NPR)'],
      ...h.incidents.map((i) => [new Date(i.occurredAt).toISOString(), INCIDENT_KIND[i.kind], SEVERITY[i.severity][0], i.status === 'OPEN' ? 'Open' : 'Fixed',
        i.location, i.odometerKm, i.driver?.name, i.description, i.resolvedAt ? new Date(i.resolvedAt).toISOString() : '', i.resolutionNote, i.repairCostNpr]),
      [],
      ['DOCUMENTS'],
      ['Document', 'Number', 'Issued by', 'Issued', 'Expires', 'Status'],
      ...h.documents.map((d) => [DOC_TYPE[d.type], d.number, d.issuer, dayIso(d.issuedAt), dayIso(d.expiresAt), EXPIRY[d.state][0]]),
      [],
      ['FUEL'],
      ['Date', 'Kilometres', 'Litres', 'Cost (NPR)', 'Full tank', 'Station'],
      ...h.fuel.logs.map((l) => [dayIso(l.filledAt), l.odometerKm, l.litres, l.costNpr, l.fullTank ? 'Yes' : 'No', l.station]),
      ['Mileage (km per litre)', h.fuel.economy.kmPerLitre ?? ''],
      [],
      ['CREW'],
      ['Name', 'Job', 'Licence', 'From', 'To'],
      ...h.crew.map((c) => [c.name, DRIVER_ROLE[c.role], c.licenceNumber, dayIso(c.startedAt), dayIso(c.endedAt) || 'Current']),
    ];
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `${h.bus.registrationNo.replace(/[^\p{L}\p{N}]+/gu, '-')}-service-history-${todayIso()}.csv`,
    });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Service history downloaded.');
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function printReport(busId){
  // Opened before the request, so the browser treats it as a response to the click rather than a pop-up.
  const w = window.open('', '_blank');
  if(!w){ notify('Allow pop-ups for this site to print the report.', 'error'); return; }
  w.document.write('<p style="font-family:sans-serif">Preparing the report…</p>');
  try{
    const h = await api(`/fleet/buses/${busId}/history`);
    const table = (heads, rows) => rows.length
      ? `<table><thead><tr>${heads.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="none">None recorded.</p>';
    w.document.open();
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service history · ${esc(h.bus.registrationNo)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#1C1A2E;margin:24px;font-size:12px}
        h1{font:700 22px Georgia,serif;margin:0}h2{font:700 15px Georgia,serif;margin:22px 0 6px;border-bottom:2px solid #5B3FA8;padding-bottom:3px}
        .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 16px;margin-top:10px}.meta b{display:block}
        table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
        th{background:#F6F1E6;font-size:11px}.none{color:#666}.foot{margin-top:24px;color:#666;font-size:11px}
        @media print{body{margin:0}@page{margin:12mm}tr{break-inside:avoid}}
      </style></head><body>
      <h1>Bus service history</h1>
      <div class="meta">
        <div><b>${esc(h.bus.registrationNo)}</b>Registration number</div><div><b>${esc(h.bus.label || '—')}</b>Bus name</div>
        <div><b>${esc(h.company.name)}</b>Company</div><div><b>${esc(num(h.bus.odometerKm))} km</b>Kilometre reading</div>
        <div><b>${esc(BUS_TYPE[h.bus.busType] || '—')}</b>Type</div><div><b>${esc(fmtDay(h.generatedAt))}</b>Report date</div>
      </div>
      <h2>Service and repairs</h2>
      ${table(['Date', 'Type', 'Km', 'Work', 'Workshop', 'Cost (NPR)', 'Parts', 'Notes'],
        h.maintenance.map((m) => [fmtDay(m.servicedAt), MAINT_KIND[m.kind], num(m.odometerKm), m.title, m.workshop, m.costNpr != null ? num(m.costNpr) : '', m.partsReplaced.join(', '), m.note]))}
      <h2>Breakdowns and emergency repairs</h2>
      ${table(['When', 'Type', 'Severity', 'Where', 'Driver', 'What happened', 'Fixed', 'Cost (NPR)'],
        h.incidents.map((i) => [fmtDateTime(i.occurredAt), INCIDENT_KIND[i.kind], SEVERITY[i.severity][0], i.location, i.driver?.name,
          i.description, i.resolvedAt ? `${fmtDay(i.resolvedAt)}: ${i.resolutionNote || ''}` : 'Still open', i.repairCostNpr != null ? num(i.repairCostNpr) : '']))}
      <h2>Documents</h2>
      ${table(['Document', 'Number', 'Issued by', 'Issued', 'Expires', 'Status'],
        h.documents.map((d) => [DOC_TYPE[d.type], d.number, d.issuer, fmtDay(d.issuedAt), fmtDay(d.expiresAt), EXPIRY[d.state][0]]))}
      <h2>Fuel</h2>
      <p>Mileage: <b>${h.fuel.economy.kmPerLitre ? `${h.fuel.economy.kmPerLitre} km per litre` : 'not enough full-tank fill-ups'}</b></p>
      ${table(['Date', 'Km', 'Litres', 'Cost (NPR)', 'Tank', 'Station'],
        h.fuel.logs.map((l) => [fmtDay(l.filledAt), num(l.odometerKm), l.litres, num(l.costNpr), l.fullTank ? 'Full' : 'Partial', l.station]))}
      <h2>Crew</h2>
      ${table(['Name', 'Job', 'Licence', 'From', 'To'], h.crew.map((c) => [c.name, DRIVER_ROLE[c.role], c.licenceNumber, fmtDay(c.startedAt), c.endedAt ? fmtDay(c.endedAt) : 'Current']))}
      <p class="foot">Generated by Bato for bus owners on ${esc(new Date(h.generatedAt).toLocaleString())}.</p>
      <script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>
      </body></html>`);
    w.document.close();
  }catch(err){
    w.close();
    if(!err.silent) notify(err.message, 'error');
  }
}
