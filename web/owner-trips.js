/* Batoma for bus owners: the duty log. Trips for owners and managers, and the duty screen,
   which is all a crew account (a conductor's phone) ever sees.

   A trip is one run of one bus in one direction, with its crew. It is what puts a
   passenger's review against the driver who was at the wheel, so starting one is two
   taps (the bus and its direction, then confirm) and changing one after 48 hours needs
   the owner to reopen it with a reason. Dates show the Nepali (BS) date beside the AD one. */

const KTM_DAY_MS = 86_400_000;
const ktmToday = () => window.BsDate ? BsDate.kathmanduDay(Date.now()) : todayIso();
const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * KTM_DAY_MS).toISOString().slice(0, 10);
const TRIP_STATUS = { IN_PROGRESS: ['On the road', 'info'], COMPLETED: ['Completed', 'good'], CANCELLED: ['Cancelled', ''] };

state.trips = { from: '', to: '', vehicleId: '', driverId: '', status: '', page: 1, range: 'today' };

/** The ends of a run, the way it is being driven. */
function runText(t){
  const r = t.route;
  if(!r) return t.direction === 'REVERSE' ? 'Return run' : 'Outbound run';
  return t.direction === 'REVERSE' ? `${r.endPlace} → ${r.startPlace}` : `${r.startPlace} → ${r.endPlace}`;
}

/** Date ranges people actually ask for, including the current Nepali month. */
function tripRange(name){
  const today = ktmToday();
  if(name === 'yesterday') return [shiftDay(today, -1), shiftDay(today, -1)];
  if(name === 'week') return [shiftDay(today, -6), today];
  if(name === 'bsmonth' && window.BsDate){
    const bs = BsDate.adToBs(today);
    if(bs){
      const first = BsDate.bsToAd(bs.year, bs.month, 1);
      const last = BsDate.bsToAd(bs.year, bs.month, BsDate.daysInBsMonth(bs.year, bs.month));
      return [first, last];
    }
  }
  return [today, today];
}

function bsMonthLabel(){
  const bs = window.BsDate?.adToBs(ktmToday());
  return bs ? `${BsDate.BS_MONTHS_EN[bs.month - 1]} ${bs.year}` : 'This month';
}

/* ================= trips (owners and managers) ================= */

SCREENS.trips = async () => {
  const f = state.trips;
  if(!f.from) [f.from, f.to] = tripRange(f.range);
  const qs = new URLSearchParams({ page: String(f.page), from: f.from, to: f.to });
  for(const k of ['vehicleId', 'driverId', 'status']) if(f[k]) qs.set(k, f[k]);
  const [data, duty, drivers] = await Promise.all([
    api(`/fleet/companies/${state.companyId}/trips?${qs}`),
    api(`/fleet/companies/${state.companyId}/duty`),
    loadDrivers(),
  ]);
  state.records.trips = Object.fromEntries(data.items.map((t) => [t.id, t]));
  state.records.duty = duty;
  const running = duty.buses.filter((b) => b.trip);
  const ranges = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['bsmonth', bsMonthLabel()]];

  return `
    ${pageHead('Trips', `${plural(data.total, 'trip')} · ${fmtDayBs(f.from)}${f.to !== f.from ? ` to ${fmtDayBs(f.to)}` : ''}`,
      `<button class="btn btn-primary" data-action="tripStartPick">+ Start a trip</button>`)}
    <p class="hint" style="margin-top:-6px">Who drove which bus, which way and when. Passenger reviews are put against the
      crew of the trip they rode, so keep this up to date: conductors can start and end trips from their phone on the
      <a href="#duty">duty screen</a>. Trips lock 48 hours after departure; an owner can reopen one, with a reason.</p>
    ${running.length ? `<div class="banner" role="status"><span aria-hidden="true">🚌</span><div>
      <b>${plural(running.length, 'bus', 'buses')} on the road now:</b>
      ${running.map((b) => `${esc(b.plateNo)} to ${esc(b.trip.direction === 'REVERSE' ? b.route?.startPlace : b.route?.endPlace)}`).join(' · ')}</div></div>` : ''}
    <div class="filters" role="group" aria-label="Which trips">
      ${ranges.map(([k, l]) => `<button class="btn btn-sm ${f.range === k ? 'btn-primary' : 'btn-ghost'}" data-action="tripRange" data-range="${k}">${esc(l)}</button>`).join('')}
      <select aria-label="Bus" data-change="tripFilter" data-field="vehicleId">
        <option value="">All buses</option>
        ${duty.buses.map((b) => `<option value="${esc(b.id)}" ${f.vehicleId === b.id ? 'selected' : ''}>${esc(b.plateNo)}</option>`).join('')}
      </select>
      <select aria-label="Crew member" data-change="tripFilter" data-field="driverId">
        <option value="">All crew</option>
        ${drivers.filter((d) => d.isActive !== false).map((d) => `<option value="${esc(d.id)}" ${f.driverId === d.id ? 'selected' : ''}>${esc(d.name)} (${esc(DRIVER_ROLE[d.role])})</option>`).join('')}
      </select>
      <select aria-label="Status" data-change="tripFilter" data-field="status">
        <option value="">Any status</option>
        ${Object.entries(TRIP_STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${data.items.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Bus</th><th>Run</th><th>Times</th><th>Crew</th><th>Km</th><th>Reviews</th><th>Status</th><th></th></tr></thead>
      <tbody>${data.items.map(tripRow).join('')}</tbody></table></div>`
      : empty('No trips in this range. Start one when a bus leaves, or ask the conductor to use the duty screen.')}
    ${data.pages > 1 ? `<div class="pager">
      <button class="btn btn-ghost btn-sm" ${data.page <= 1 ? 'disabled' : ''} data-action="tripPage" data-page="${data.page - 1}">← Previous</button>
      <span class="muted small">Page ${data.page} of ${data.pages}</span>
      <button class="btn btn-ghost btn-sm" ${data.page >= data.pages ? 'disabled' : ''} data-action="tripPage" data-page="${data.page + 1}">Next →</button></div>` : ''}`;
};

function tripRow(t){
  const crew = [t.driver && `${esc(t.driver.name)} <span class="muted">driver</span>`,
    t.conductor && `${esc(t.conductor.name)} <span class="muted">conductor</span>`,
    t.helper && `${esc(t.helper.name)} <span class="muted">helper</span>`].filter(Boolean).join('<br>') || '<span class="muted">Not recorded</span>';
  const actions = [
    t.status === 'IN_PROGRESS' ? `<button class="btn btn-sm btn-brand" data-action="tripEnd" data-id="${esc(t.id)}">End</button>` : '',
    canManage() && !t.locked ? `<button class="btn btn-sm btn-ghost" data-action="tripEdit" data-id="${esc(t.id)}">Edit</button>` : '',
    t.locked && isOwner() ? `<button class="btn btn-sm btn-ghost" data-action="tripUnlock" data-id="${esc(t.id)}">Reopen</button>` : '',
  ].join('');
  return `
    <tr>
      <td>${fmtDayBs(t.departAt)}</td>
      <td><a href="#bus/${esc(t.vehicle.id)}"><span class="plate">${esc(t.vehicle.plateNo)}</span></a></td>
      <td>${esc(runText(t))}</td>
      <td>${fmtTime(t.departAt)}${t.arriveAt ? ` – ${fmtTime(t.arriveAt)}` : ''}</td>
      <td class="small">${crew}</td>
      <td>${t.km != null ? num(t.km) : '—'}</td>
      <td>${t.reviews ? `<a href="#feedback" data-action="tripReviews" data-driver="${esc(t.driver?.id || '')}">${t.reviews}</a>` : '0'}</td>
      <td>${pill(TRIP_STATUS[t.status])}${t.locked ? ` ${pill(['Locked', ''])}` : ''}${t.unlockedUntil ? ` ${pill(['Reopened', 'warn'])}` : ''}</td>
      <td class="nowrap">${actions}</td>
    </tr>`;
}

/* ================= duty screen (everyone, and all that crew accounts see) ================= */

SCREENS.duty = async () => {
  const duty = await api(`/fleet/companies/${state.companyId}/duty`);
  state.records.duty = duty;
  return `
    ${pageHead('Duty', `${esc(duty.company.name)} · ${fmtDayBs(new Date())}`)}
    <p class="hint" style="margin-top:-6px">Tap where the bus is going when it leaves, and End when it arrives. That is how
      passengers' reviews reach the right driver.</p>
    ${duty.buses.length ? `<div class="duty-grid">${duty.buses.map(dutyCard).join('')}</div>`
      : empty('No buses yet. The owner adds them in the portal.')}`;
};

function dutyCard(b){
  const r = b.route;
  const crew = b.crew.length ? b.crew.map((c) => `${esc(c.name)} (${esc(DRIVER_ROLE[c.role])})`).join(' · ') : 'No crew assigned';
  if(b.trip){
    const towards = b.trip.direction === 'REVERSE' ? r?.startPlace : r?.endPlace;
    const onBoard = [b.trip.driver?.name, b.trip.conductor?.name].filter(Boolean).map(esc).join(' · ');
    return `
      <section class="duty-card on">
        <div class="duty-top"><span class="plate">${esc(b.plateNo)}</span>${b.label ? `<span class="muted">${esc(b.label)}</span>` : ''}</div>
        <p class="duty-state">On the road to <b>${esc(towards || 'its destination')}</b> since ${fmtTime(b.trip.departAt)}</p>
        ${onBoard ? `<p class="muted small">${onBoard}</p>` : ''}
        ${b.trip.stale ? '<div class="banner warn small">This trip was never ended. End it now; reviews stopped counting it after a day.</div>' : ''}
        <button class="btn btn-primary duty-btn" data-action="tripEnd" data-id="${esc(b.trip.id)}">End trip</button>
      </section>`;
  }
  return `
    <section class="duty-card">
      <div class="duty-top"><span class="plate">${esc(b.plateNo)}</span>${b.label ? `<span class="muted">${esc(b.label)}</span>` : ''}</div>
      ${r ? `<p class="muted small">${esc(r.name)} · ${crew}</p>
        <div class="duty-dirs">
          <button class="btn btn-brand duty-btn" data-action="tripStart" data-bus="${esc(b.id)}" data-direction="FORWARD">To ${esc(r.endPlace)}</button>
          <button class="btn btn-brand duty-btn" data-action="tripStart" data-bus="${esc(b.id)}" data-direction="REVERSE">To ${esc(r.startPlace)}</button>
        </div>`
      : '<p class="muted small">This bus has no route yet. The owner sets it in the portal before trips can be logged.</p>'}
    </section>`;
}

/* ================= actions ================= */

const tripBus = (id) => state.records.duty?.buses.find((b) => b.id === id);

/** Tap two: confirm the bus, direction and crew. Owners and managers may change the crew. */
async function startTrip(busId, direction){
  const bus = tripBus(busId);
  if(!bus) return;
  const towards = direction === 'REVERSE' ? bus.route.startPlace : bus.route.endPlace;
  const assigned = (role) => bus.crew.find((c) => c.role === role)?.id || '';
  const fields = [];
  let drivers = [];
  if(canManage()){
    drivers = (await loadDrivers()).filter((d) => d.isActive !== false);
    const pick = (role, label) => ({
      name: `${role.toLowerCase()}Id`, label, type: 'select',
      options: [['', 'Nobody'], ...drivers.filter((d) => d.role === role).map((d) => [d.id, d.name])],
    });
    fields.push(pick('DRIVER', 'Driver'), pick('CONDUCTOR', 'Conductor'), pick('HELPER', 'Helper'),
      { name: 'departAt', label: 'Left at', type: 'datetime-local' });
  }
  fields.push({ name: 'startOdometerKm', label: 'Odometer (km), if you have it', type: 'number', min: 0, full: true });
  // A pre-filled "now" is only to the minute; left as it is, the server's own clock is used.
  const shownNow = nowLocal();
  const crewText = bus.crew.length ? bus.crew.map((c) => `${c.name} (${DRIVER_ROLE[c.role].toLowerCase()})`).join(', ') : 'nobody assigned';
  const started = await openForm({
    title: `${bus.plateNo} to ${towards}`,
    intro: canManage() ? 'The crew assigned to this bus is filled in; change it if someone else is on board.'
      : `Crew: ${crewText}. If that is wrong, tell the office.`,
    submitLabel: 'Start trip',
    fields,
    values: { driverId: assigned('DRIVER'), conductorId: assigned('CONDUCTOR'), helperId: assigned('HELPER'), departAt: shownNow },
    onSubmit: (v) => {
      const body = { direction };
      if(v.startOdometerKm != null) body.startOdometerKm = v.startOdometerKm;
      if(canManage()){
        const changed = ['driverId', 'conductorId', 'helperId'].some((k) => (v[k] || '') !== assigned(k.replace('Id', '').toUpperCase()));
        if(changed) Object.assign(body, { driverId: v.driverId, conductorId: v.conductorId, helperId: v.helperId });
        if(v.departAt && v.departAt !== shownNow) body.departAt = new Date(v.departAt).toISOString();
      }
      return api(`/fleet/buses/${busId}/trips`, { method: 'POST', body });
    },
  });
  if(started){ notify(`Trip started: ${bus.plateNo} to ${towards}.`); renderApp(); }
}

/** From the Trips screen: tap one, the bus and its direction. */
async function pickBusForTrip(){
  const buses = (state.records.duty?.buses || []).filter((b) => b.route);
  const options = buses.flatMap((b) => b.trip ? [] : [
    [`${b.id}|FORWARD`, `${b.plateNo} · to ${b.route.endPlace}`],
    [`${b.id}|REVERSE`, `${b.plateNo} · to ${b.route.startPlace}`],
  ]);
  if(!options.length){ notify('Every bus with a route is already on a trip.', 'error'); return; }
  const choice = await askDialog({
    title: 'Start a trip', message: 'Which bus is leaving, and which way?', confirmLabel: 'Next',
    field: { label: 'Bus and direction', type: 'select', options },
  });
  if(!choice) return;
  const [busId, direction] = choice.split('|');
  startTrip(busId, direction);
}

async function endTrip(tripId){
  const t = state.records.trips?.[tripId];
  const busTrip = state.records.duty?.buses.find((b) => b.trip?.id === tripId);
  const plate = t?.vehicle.plateNo || busTrip?.plateNo || 'This bus';
  const shownNow = nowLocal();
  const ended = await openForm({
    title: `End the trip: ${plate}`, submitLabel: 'End trip',
    intro: 'Arrival is now unless you change it.',
    fields: [
      { name: 'arriveAt', label: 'Arrived at', type: 'datetime-local' },
      { name: 'endOdometerKm', label: 'Odometer (km), if you have it', type: 'number', min: 0 },
    ],
    values: { arriveAt: shownNow },
    onSubmit: (v) => {
      const body = {};
      // Left at the pre-filled minute, the arrival is "now" to the second, on the server.
      if(v.arriveAt && v.arriveAt !== shownNow) body.arriveAt = new Date(v.arriveAt).toISOString();
      if(v.endOdometerKm != null) body.endOdometerKm = v.endOdometerKm;
      return api(`/fleet/trips/${tripId}/end`, { method: 'POST', body });
    },
  });
  if(ended){ notify('Trip ended.'); renderApp(); }
}

const localInput = (d) => d ? new Date(new Date(d).getTime() - new Date(d).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

async function editTrip(tripId){
  const t = state.records.trips?.[tripId];
  if(!t) return;
  const drivers = (await loadDrivers()).filter((d) => d.isActive !== false || [t.driver?.id, t.conductor?.id, t.helper?.id].includes(d.id));
  const pick = (role, label) => ({
    name: `${role.toLowerCase()}Id`, label, type: 'select',
    options: [['', 'Nobody'], ...drivers.filter((d) => d.role === role).map((d) => [d.id, d.name])],
  });
  const r = t.route;
  const saved = await openForm({
    title: `Correct the trip: ${t.vehicle.plateNo}`, submitLabel: 'Save', wide: true,
    intro: `${fmtDayBs(t.departAt)}. Changes are recorded with your name.`,
    fields: [
      { name: 'direction', label: 'Direction', type: 'select', options: [
        ['FORWARD', r ? `${r.startPlace} → ${r.endPlace}` : 'Outbound'], ['REVERSE', r ? `${r.endPlace} → ${r.startPlace}` : 'Return']] },
      { name: 'status', label: 'Status', type: 'select', options: t.status === 'IN_PROGRESS'
        ? [['', 'On the road'], ['CANCELLED', 'Cancelled: did not run']]
        : [['COMPLETED', 'Completed'], ['CANCELLED', 'Cancelled: did not run']] },
      { name: 'departAt', label: 'Left at', type: 'datetime-local', required: true },
      { name: 'arriveAt', label: 'Arrived at', type: 'datetime-local' },
      pick('DRIVER', 'Driver'), pick('CONDUCTOR', 'Conductor'), pick('HELPER', 'Helper'),
      { name: 'startOdometerKm', label: 'Odometer at departure (km)', type: 'number', min: 0 },
      { name: 'endOdometerKm', label: 'Odometer at arrival (km)', type: 'number', min: 0 },
    ],
    values: {
      direction: t.direction, status: t.status === 'IN_PROGRESS' ? '' : t.status,
      departAt: localInput(t.departAt), arriveAt: localInput(t.arriveAt),
      driverId: t.driver?.id || '', conductorId: t.conductor?.id || '', helperId: t.helper?.id || '',
      startOdometerKm: t.startOdometerKm ?? '', endOdometerKm: t.endOdometerKm ?? '',
    },
    onSubmit: (v) => api(`/fleet/trips/${tripId}`, { method: 'PATCH', body: {
      direction: v.direction, ...(v.status ? { status: v.status } : {}),
      departAt: new Date(v.departAt).toISOString(), arriveAt: v.arriveAt ? new Date(v.arriveAt).toISOString() : '',
      driverId: v.driverId, conductorId: v.conductorId, helperId: v.helperId,
      startOdometerKm: v.startOdometerKm ?? '', endOdometerKm: v.endOdometerKm ?? '',
    } }),
  });
  if(saved){ notify('Trip saved.'); renderApp(); }
}

async function unlockTrip(tripId){
  const t = state.records.trips?.[tripId];
  const reason = await askDialog({
    title: 'Reopen this trip?', confirmLabel: 'Reopen for 24 hours',
    message: `${t ? `${t.vehicle.plateNo}, ${fmtDayBs(t.departAt)}. ` : ''}It has been locked since 48 hours after departure. Your reason is kept in the company's record.`,
    field: { label: 'Why it needs changing', type: 'textarea', required: true, maxlength: 300 },
  });
  if(!reason) return;
  try{
    await api(`/fleet/trips/${tripId}/unlock`, { method: 'POST', body: { reason } });
    notify('Reopened for 24 hours.');
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

Actions.on({
  tripStart: (el) => startTrip(el.dataset.bus, el.dataset.direction),
  tripStartPick: () => pickBusForTrip(),
  tripEnd: (el) => endTrip(el.dataset.id),
  tripEdit: (el) => editTrip(el.dataset.id),
  tripUnlock: (el) => unlockTrip(el.dataset.id),
  tripRange: (el) => { Object.assign(state.trips, { range: el.dataset.range, from: '', to: '', page: 1 }); renderApp(); },
  tripPage: (el) => { state.trips.page = Number(el.dataset.page); renderApp(); },
  tripReviews: (el, ev) => {
    ev.preventDefault();
    Object.assign(state.feedback, { driverId: el.dataset.driver, page: 1 });
    go('feedback');
  },
});

Actions.onChange({
  tripFilter: (el) => { state.trips[el.dataset.field] = el.value; state.trips.page = 1; renderApp(); },
});
