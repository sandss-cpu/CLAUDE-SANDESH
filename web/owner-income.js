/* Batoma for bus owners: daily income and ticket records.

   Off until an owner with an authenticator app turns them on (Company page). Owners and
   managers enter income on a phone-friendly daily sheet or import a portal's CSV/XLSX
   export; totals, reports and reconciliation are for owners, and for managers only when
   the owner shares them. Money is held as paisa and shown in Nepali grouping; dates show
   BS beside AD. */
'use strict';

const SOURCE_KIND = { CASH: 'Cash', PORTAL: 'Online portal', CARGO: 'Parcels', HIRE: 'Hire', OTHER: 'Other' };
const IMPORT_FIELDS = [
  ['date', 'Date', true], ['reference', 'Settlement or booking reference', false], ['gross', 'Amount (gross)', false],
  ['fees', 'Fees or commission', false], ['net', 'Net amount', false], ['tickets', 'Tickets', false], ['seats', 'Seats', false],
  ['plate', 'Bus number', false], ['note', 'Note', false],
];

state.income = { range: 'bsmonth', from: '', to: '', groupBy: 'bus', bucket: 'day', file: null, sourceId: '', preview: null, mapping: null };
state.sheetRows = {};

/** "NPR 1,23,456.50": paisa in the grouping owners read every day. */
function rupees(paisa, symbol = true){
  if(paisa == null) return '—';
  const neg = paisa < 0;
  const abs = Math.abs(Math.round(paisa));
  const whole = String(Math.floor(abs / 100));
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const frac = abs % 100 ? `.${String(abs % 100).padStart(2, '0')}` : '';
  return `${neg ? '-' : ''}${symbol ? 'NPR ' : ''}${rest ? `${rest},` : ''}${last3}${frac}`;
}

/** What someone typed as rupees, to paisa: "1,500.50" → 150050. Blank is 0; anything else is NaN. */
function toPaisa(text){
  const t = String(text ?? '').trim().replace(/^(npr|rs\.?)\s*/i, '').replace(/,/g, '');
  if(!t) return 0;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : NaN;
}
/** Short amounts for chart labels, the way they are said in Nepal: 39k, 13.9 lakh, 1.2 crore. */
function shortRupees(paisa){
  const r = (paisa || 0) / 100;
  if(r >= 1e7) return `${(r / 1e7).toFixed(1).replace(/\.0$/, '')} crore`;
  if(r >= 1e5) return `${(r / 1e5).toFixed(1).replace(/\.0$/, '')} lakh`;
  if(r >= 1e3) return `${Math.round(r / 1e3)}k`;
  return String(Math.round(r));
}
const rupeesInput = (paisa) => paisa ? (paisa / 100).toFixed(paisa % 100 ? 2 : 0) : '';
const financeOn = () => !!state.company?.finance?.enabled;
const seesTotals = () => !!state.company?.finance?.canSeeTotals;

function financeOff(){
  return `${pageHead('Income', '')}<section class="panel">${empty('Income records are switched off for this company.')}
    <p class="hint">${isOwner() ? 'Turn them on under <a href="#company">Company</a>. You will need an authenticator app.' : 'The company owner can turn them on under Company.'}</p></section>`;
}

/** Report periods: this and last Nepali month, the last 30 days, the Nepali year so far, or chosen days. */
function incomePeriod(){
  const f = state.income;
  const today = ktmToday();
  if(f.range === 'custom' && f.from && f.to) return [f.from, f.to];
  if(f.range === '30') return [shiftDay(today, -29), today];
  const bs = window.BsDate?.adToBs(today);
  if(bs){
    if(f.range === 'bsyear') return [BsDate.bsToAd(bs.year, 1, 1), today];
    let { year, month } = bs;
    if(f.range === 'lastbsmonth'){ month -= 1; if(month < 1){ month = 12; year -= 1; } }
    const first = BsDate.bsToAd(year, month, 1);
    const last = BsDate.bsToAd(year, month, BsDate.daysInBsMonth(year, month));
    if(first && last) return [first, last > today ? today : last];
  }
  return [shiftDay(today, -29), today];
}

function periodBar(submitName){
  const f = state.income;
  const [from, to] = incomePeriod();
  const bs = window.BsDate?.adToBs(ktmToday());
  const presets = [['bsmonth', bsMonthLabel()], ['lastbsmonth', bs ? BsDate.BS_MONTHS_EN[(bs.month + 10) % 12] : 'Last month'], ['30', 'Last 30 days'], ['bsyear', bs ? `Year ${bs.year}` : 'This year']];
  return `<form class="filters" data-submit="${submitName}" aria-label="Period">
    ${presets.map(([k, l]) => `<button type="button" class="btn btn-sm ${f.range === k ? 'btn-primary' : 'btn-ghost'}" data-action="incomeRange" data-range="${k}">${esc(l)}</button>`).join('')}
    <label class="inline">From <input type="date" name="from" value="${esc(from)}" max="${esc(ktmToday())}"></label>
    <label class="inline">To <input type="date" name="to" value="${esc(to)}" max="${esc(ktmToday())}"></label>
    <button class="btn btn-sm btn-ghost" type="submit">Show</button>
  </form>`;
}

/* ================= the income screen and its tabs ================= */

SCREENS.income = async ({ id: tab }) => {
  if(!financeOn()) return financeOff();
  const tabs = [
    ...(seesTotals() ? [['overview', 'Overview']] : []),
    ['sheets', 'Daily sheets'], ['import', 'Import'],
    ...(seesTotals() ? [['reports', 'Reports'], ['reconcile', 'Reconcile']] : []),
    ...(isOwner() ? [['sources', 'Sources']] : []),
  ];
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const body = await INCOME_TABS[current]();
  return `
    ${pageHead('Income', seesTotals() ? 'What each bus earns, by day, source and trip' : 'Record what each bus earns. Totals are kept for the owner.')}
    <nav class="tabs" role="tablist" aria-label="Income">
      ${tabs.map(([k, l]) => `<a role="tab" href="#income/${k}" aria-selected="${k === current}">${l}</a>`).join('')}
    </nav>
    <div role="tabpanel">${body}</div>`;
};

const INCOME_TABS = {};

INCOME_TABS.overview = async () => {
  const d = await api(`/fleet/companies/${state.companyId}/income/dashboard`);
  const change = d.change == null ? 'No income on the same days last month'
    : `${d.change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d.change * 100))}% on the same days of last month`;
  const max = Math.max(1, ...d.daily.map((p) => p.netPaisa));
  const points = d.daily.map((p, i) => `${(i / (d.daily.length - 1)) * 300},${100 - (p.netPaisa / max) * 92}`).join(' ');
  return `
    <div class="kpis">
      ${kpi('₨', 'Today', rupees(d.today.netPaisa), `${plural(d.today.tickets, 'ticket')} · ${esc(d.todayBs)}`)}
      ${kpi('📅', 'This month', rupees(d.thisMonth.netPaisa), esc(change))}
      ${kpi('🗓', 'Last month', rupees(d.lastMonth.netPaisa), `Same days: ${rupees(d.lastMonth.sameDaysNetPaisa)}`)}
      ${kpi('🏆', 'Best bus this month', d.bestBus ? `<span class="plate">${esc(d.bestBus.plateNo)}</span>` : '—', d.bestBus ? rupees(d.bestBus.netPaisa) : 'No income yet', d.bestBus ? `bus/${d.bestBus.id}` : '')}
      ${kpi('⚠', 'Lowest this month', d.worstBus ? `<span class="plate">${esc(d.worstBus.plateNo)}</span>` : '—', d.worstBus ? rupees(d.worstBus.netPaisa) : 'Needs two buses with income', d.worstBus ? `bus/${d.worstBus.id}` : '')}
    </div>
    <div class="grid-2">
      <section class="panel"><div class="panel-head"><h2>By month</h2><span class="muted small">Net income, last 12 months</span></div>
        ${columns(d.monthly, { value: (m) => m.netPaisa, label: (m) => monthShort(`${m.month}-01`), text: (m) => shortRupees(m.netPaisa) })}
      </section>
      <section class="panel"><div class="panel-head"><h2>Last 30 days</h2><span class="muted small">Net income per day</span></div>
        <svg class="line-chart" viewBox="0 0 300 104" role="img" aria-label="Daily net income for the last 30 days, highest ${esc(rupees(max))}">
          <polyline points="${points}" fill="none" stroke="var(--brand)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="line-axis"><span>${fmtDay(d.daily[0].day)}</span><span>Highest ${rupees(max)}</span><span>${fmtDay(d.daily[d.daily.length - 1].day)}</span></div>
      </section>
    </div>
    <p class="hint">Income is what reached the company after portal fees. <a href="#income/reports">Reports</a> set it against fuel, maintenance and repairs.</p>`;
};

INCOME_TABS.sheets = async () => {
  const data = await api(`/fleet/companies/${state.companyId}/buses?archived=false&page=1`);
  const buses = data.items || data;
  const today = ktmToday();
  return `<section class="panel">
    <div class="panel-head"><h2>Daily sheets</h2><span class="muted small">${esc(fmtDayBs(today))}</span></div>
    ${buses.length ? `<div class="sheet-list">${buses.map((b) => `
      <a class="sheet-link" href="#sheet/${esc(b.id)}/${today}"><span class="plate">${esc(b.registrationNo)}</span>
        <span>${esc(b.label || '')}</span><span class="go">Today’s sheet →</span></a>`).join('')}</div>`
      : empty('No buses yet.')}
    <form class="filters" data-submit="openSheetDay" style="margin-top:14px">
      <label class="inline">Another day <input type="date" name="day" max="${esc(today)}" required></label>
      <select name="bus" aria-label="Bus">${buses.map((b) => `<option value="${esc(b.id)}">${esc(b.registrationNo)}</option>`).join('')}</select>
      <button class="btn btn-sm btn-ghost" type="submit">Open</button>
    </form>
  </section>`;
};

/* ================= one bus, one day ================= */

SCREENS.sheet = async ({ id: busId, tab: day }) => {
  if(!financeOn()) return financeOff();
  const date = day || ktmToday();
  const s = await api(`/fleet/buses/${busId}/income?date=${encodeURIComponent(date)}`);
  state.records.sheet = s;
  const key = `${busId}|${date}`;
  const used = new Set(s.entries.map((e) => e.sourceId));
  // New rows: what was added here, or yesterday's sources, or the two kinds of cash.
  if(!state.sheetRows[key]){
    const start = s.yesterdaySourceIds.length ? s.yesterdaySourceIds : s.sources.filter((x) => x.kind === 'CASH' && x.isActive).slice(0, 2).map((x) => x.id);
    state.sheetRows[key] = s.entries.length ? [] : start.filter((id) => !used.has(id));
  }
  const fresh = state.sheetRows[key].map((id) => s.sources.find((x) => x.id === id)).filter(Boolean);
  const addable = s.sources.filter((x) => x.isActive);
  const prev = shiftDay(date, -1);
  const next = shiftDay(date, 1);
  return `
    <p class="crumbs"><a href="#income/sheets">← Daily sheets</a></p>
    <div class="page-head"><div><h1><span class="plate">${esc(s.bus.plateNo)}</span> ${esc(s.bus.label || '')}</h1>
      <div class="muted">${esc(fmtDay(date))} · ${esc(s.dateBs)}</div></div>
      <div class="actions">
        <a class="btn btn-ghost btn-sm" href="#sheet/${esc(busId)}/${prev}" aria-label="Previous day">← ${esc(fmtDay(prev))}</a>
        ${next <= ktmToday() ? `<a class="btn btn-ghost btn-sm" href="#sheet/${esc(busId)}/${next}" aria-label="Next day">${esc(fmtDay(next))} →</a>` : ''}
      </div></div>
    <form class="panel sheet" data-submit="saveSheet" data-bus="${esc(busId)}" data-date="${esc(date)}" data-input="sheetTotals" novalidate>
      ${s.entries.map((e) => sheetRow(s, e.sourceId, e)).join('')}
      ${fresh.map((src) => sheetRow(s, src.id, null)).join('')}
      ${!s.entries.length && !fresh.length ? empty('Add the sources this bus earned from today.') : ''}
      <div class="sheet-add">
        <select data-change="addSheetSource" data-key="${esc(key)}" aria-label="Add a source">
          <option value="">+ Add a source…</option>
          ${addable.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
        </select>
        ${s.yesterdaySourceIds.length ? `<button type="button" class="btn btn-sm btn-ghost" data-action="copyYesterday" data-key="${esc(key)}">Same sources as yesterday</button>` : ''}
      </div>
      <div class="sheet-total" aria-live="polite" id="sheetTotal"></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save the day</button></div>
      <p class="hint">Entries can be corrected for 7 days after they are saved, then they lock. A settlement reference
        can be entered once per source, so the same portal payment is never counted twice.</p>
    </form>`;
};

function sheetRow(s, sourceId, e){
  const src = s.sources.find((x) => x.id === sourceId) || { name: e?.source || 'Source', kind: e?.sourceKind || 'OTHER' };
  const locked = e?.locked;
  const dis = locked ? 'disabled' : '';
  const portal = src.kind === 'PORTAL' || src.kind === 'OTHER' || (e && (e.feesPaisa || e.reference));
  const rid = e?.id || `new-${sourceId}`;
  if(locked){
    // Past the 7 days: a line to read, not a form to fill; the totals still count it.
    const trip = s.trips.find((t) => t.id === e.tripId);
    return `<div class="sheet-row locked" data-locked-net="${e.netPaisa}" data-locked-tickets="${e.ticketsSold}">
      <div><b>${esc(src.name)}</b> <span class="pill">🔒 Locked</span>${e.importId ? ' <span class="pill info">Imported</span>' : ''}</div>
      <div class="locked-line">${plural(e.ticketsSold, 'ticket')} · ${rupees(e.grossPaisa)}${e.feesPaisa ? ` less ${rupees(e.feesPaisa)} fees = ${rupees(e.netPaisa)}` : ''}
        ${e.reference ? ` · ref ${esc(e.reference)}` : ''}${trip ? ` · ${esc(fmtTime(trip.departAt))} ${esc(trip.run || '')}` : ''}${e.note ? ` · ${esc(e.note)}` : ''}</div>
      ${e.hasAttachment ? `<button type="button" class="link" data-action="viewStatement" data-id="${esc(e.id)}">View statement photo</button>` : ''}
    </div>`;
  }
  return `<fieldset class="sheet-row" data-row="${esc(e?.id || '')}" data-source="${esc(sourceId)}">
    <legend><b>${esc(src.name)}</b> <span class="muted small">${esc(SOURCE_KIND[src.kind] || '')}</span>
      ${locked ? ' <span class="pill">🔒 Locked</span>' : ''}${e?.importId ? ' <span class="pill info">Imported</span>' : ''}</legend>
    <div class="sheet-grid">
      <label>Tickets<input name="tickets" inputmode="numeric" pattern="[0-9]*" value="${e ? e.ticketsSold : ''}" ${dis} aria-describedby="h-${rid}"></label>
      <label>Amount (NPR)<input name="gross" inputmode="decimal" value="${e ? rupeesInput(e.grossPaisa) : ''}" ${dis}></label>
      ${portal ? `<label>Fees (NPR)<input name="fees" inputmode="decimal" value="${e ? rupeesInput(e.feesPaisa) : ''}" ${dis}></label>
      <label>Reference<input name="reference" maxlength="120" value="${esc(e?.reference || '')}" ${dis} placeholder="Settlement number"></label>` : ''}
      ${s.trips.length ? `<label>Trip<select name="trip" ${dis}><option value="">Not one trip</option>
        ${s.trips.map((t) => `<option value="${esc(t.id)}" ${e?.tripId === t.id ? 'selected' : ''}>${esc(fmtTime(t.departAt))} ${esc(t.run || '')} ${t.driver ? `· ${esc(t.driver)}` : ''}</option>`).join('')}</select></label>` : ''}
      <label class="wide">Note<input name="note" maxlength="500" value="${esc(e?.note || '')}" ${dis}></label>
    </div>
    <div class="row-net muted small" id="h-${rid}"></div>
    ${e ? `<div class="sheet-row-actions">
      ${e.hasAttachment ? `<button type="button" class="link" data-action="viewStatement" data-id="${esc(e.id)}">View statement photo</button>` : ''}
      ${!locked ? `<label class="link file-link">📷 ${e.hasAttachment ? 'Replace photo' : 'Statement photo'}<input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" capture="environment" data-change="attachStatement" data-id="${esc(e.id)}"></label>
        <button type="button" class="link danger" data-action="deleteIncome" data-id="${esc(e.id)}">Delete</button>` : ''}
    </div>` : ''}
  </fieldset>`;
}

AFTER_RENDER.sheet = (main) => { const f = main.querySelector('form.sheet'); if(f) sheetTotals(f); };

/** Reads one sheet row; amounts in paisa. */
function readRow(el){
  const v = (n) => el.querySelector(`[name="${n}"]`)?.value ?? '';
  const row = {
    id: el.dataset.row || undefined, sourceId: el.dataset.source,
    ticketsSold: v('tickets').trim() === '' ? 0 : Number(v('tickets')),
    grossPaisa: toPaisa(v('gross')), feesPaisa: toPaisa(v('fees')),
    reference: v('reference').trim() || null, note: v('note').trim() || null, tripId: v('trip') || null,
  };
  return row;
}

function sheetTotals(form){
  const f = form.closest ? form.closest('form.sheet') : null;
  if(!f) return;
  let net = 0; let tickets = 0; let bad = false;
  f.querySelectorAll('.sheet-row').forEach((el) => {
    if(el.dataset.lockedNet != null){ net += Number(el.dataset.lockedNet); tickets += Number(el.dataset.lockedTickets); return; }
    const r = readRow(el);
    const rowNet = r.grossPaisa - r.feesPaisa;
    const hint = el.querySelector('.row-net');
    if(Number.isNaN(r.grossPaisa) || Number.isNaN(r.feesPaisa) || !Number.isInteger(r.ticketsSold) || r.ticketsSold < 0){
      bad = true; if(hint) hint.textContent = 'Check the numbers in this row.';
      return;
    }
    if(hint) hint.textContent = r.feesPaisa ? `Net ${rupees(rowNet)}` : '';
    net += rowNet; tickets += r.ticketsSold;
  });
  const box = f.querySelector('#sheetTotal');
  if(box) box.innerHTML = bad ? '<span class="error-text">Some numbers need checking.</span>'
    : `<b>${rupees(net)}</b> net · ${plural(tickets, 'ticket')}${state.records.sheet?.bus.seatCount ? ` · ${state.records.sheet.bus.seatCount} seats` : ''}`;
}

async function saveSheet(form, ev){
  ev.preventDefault();
  const rows = [...form.querySelectorAll('.sheet-row:not(.locked)')].map(readRow);
  if(rows.some((r) => Number.isNaN(r.grossPaisa) || Number.isNaN(r.feesPaisa) || !Number.isInteger(r.ticketsSold) || r.ticketsSold < 0)){
    notify('Some numbers need checking: amounts like 1500 or 1,500.50, tickets as whole numbers.', 'error');
    return;
  }
  if(rows.some((r) => r.feesPaisa > r.grossPaisa)){ notify('Fees cannot be larger than the amount.', 'error'); return; }
  const key = `${form.dataset.bus}|${form.dataset.date}`;
  try{
    await api(`/fleet/buses/${form.dataset.bus}/income/${form.dataset.date}`, { method: 'PUT', body: { rows } });
    state.sheetRows[key] = [];
    notify('Saved.');
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/** Adds rows in place, so figures typed into other rows and not yet saved are kept. */
function insertSheetRows(form, key, ids){
  const s = state.records.sheet;
  const list = state.sheetRows[key] ||= [];
  const anchor = form.querySelector('.sheet-add');
  const shown = new Set([...form.querySelectorAll('.sheet-row')].map((r) => r.dataset.source).filter(Boolean));
  ids.filter((id) => !shown.has(id)).forEach((id) => {
    if(!list.includes(id)) list.push(id);
    anchor.insertAdjacentHTML('beforebegin', sheetRow(s, id, null));
  });
  form.querySelector('.sheet > .empty, form.sheet .empty')?.remove();
  sheetTotals(form);
}

function addSheetSource(el){
  const id = el.value;
  el.value = '';
  if(id) insertSheetRows(el.closest('form'), el.dataset.key, [id]);
}

function copyYesterday(el){
  insertSheetRows(el.closest('form'), el.dataset.key, state.records.sheet.yesterdaySourceIds);
}

async function deleteIncome(id){
  const ok = await askDialog({ title: 'Delete this entry?', message: 'It leaves the sheet and the totals. The audit trail keeps a record that it was deleted.', confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ await api(`/fleet/income/${id}`, { method: 'DELETE' }); notify('Deleted.'); renderApp(); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function attachStatement(input){
  const file = input.files?.[0];
  if(!file) return;
  const fd = new FormData();
  fd.append('file', await prepareImage(file, 2000));
  try{ await api(`/fleet/income/${input.dataset.id}/attachment`, { method: 'POST', body: fd }); notify('Statement photo saved.'); renderApp(); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function viewStatement(id){
  try{
    const { url } = await api(`/fleet/income/${id}/attachment`);
    await openForm({
      title: 'Statement photo', wide: true, submitLabel: 'Close', fields: [],
      html: `<img class="statement" src="${esc(url)}" alt="Photo of the settlement statement">
        <p class="hint">This link works for five minutes and only for your account’s session.</p>`,
      onSubmit: async () => true,
    });
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/* ================= importing a portal export ================= */

INCOME_TABS.import = async () => {
  const [sources, imports, busesData] = await Promise.all([
    api(`/fleet/companies/${state.companyId}/income/sources`),
    api(`/fleet/companies/${state.companyId}/income/imports`),
    api(`/fleet/companies/${state.companyId}/buses?archived=false&page=1`),
  ]);
  const buses = busesData.items || busesData;
  state.records.importSources = sources;
  const f = state.income;
  const p = f.preview;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Import a portal export</h2><span class="muted small">CSV or Excel (.xlsx)</span></div>
      <form class="filters" data-submit="previewImport">
        <select name="sourceId" required aria-label="Which source">
          <option value="">Which source is this file from?</option>
          ${sources.filter((x) => x.isActive).map((x) => `<option value="${esc(x.id)}" ${f.sourceId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>
        <input type="file" name="file" accept=".csv,.xlsx,text/csv" required aria-label="File">
        <button class="btn btn-primary btn-sm" type="submit">Check the file</button>
      </form>
      <p class="hint">Nothing is saved until you have seen the check. Bussewa, eSewa and Khalti do not offer a direct
        connection, so export the settlement report from their website and import it here. Rows already entered, by
        settlement reference, are skipped.</p>
    </section>
    ${p ? importPreview(p, buses) : ''}
    <section class="panel">
      <div class="panel-head"><h2>Recent imports</h2><span class="muted small">Undo is possible for 24 hours</span></div>
      ${imports.length ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Source</th><th>File</th><th>Saved</th><th>Skipped</th><th></th></tr></thead>
        <tbody>${imports.map((i) => `<tr>
          <td>${esc(fmtDateTime(i.createdAt))}</td><td>${esc(i.source)}</td><td>${esc(i.filename)}</td>
          <td>${i.undoneAt ? `<s>${i.created}</s> undone` : i.created}</td><td>${plural(i.duplicates, 'duplicate')} · ${plural(i.invalid, 'problem')}</td>
          <td>${i.canUndo ? `<button class="link danger" data-action="undoImport" data-id="${esc(i.id)}">Undo</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No imports yet.')}
    </section>`;
};

function importPreview(p, buses){
  const m = p.mapping;
  const col = (field) => `<select name="col-${field}" aria-label="Column for ${field}">
    <option value="">Not in this file</option>
    ${p.headers.map((h) => `<option value="${esc(h)}" ${m.columns[field] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
  const status = { ok: ['Will import', 'good'], duplicate: ['Already entered', ''], invalid: ['Problem', 'bad'] };
  return `<section class="panel">
    <div class="panel-head"><h2>Check: ${esc(p.source.name)}</h2><span class="muted small">${esc(state.income.file?.name || '')} · ${esc(p.format.toUpperCase())} · ${plural(p.counts.rows, 'row')}</span></div>
    <div class="kpis">
      ${kpi('✓', 'To import', String(p.counts.ok), rupees(p.counts.netPaisa))}
      ${kpi('↺', 'Already entered', String(p.counts.duplicates), 'Same settlement reference')}
      ${kpi('⚠', 'Problems', String(p.counts.invalid), 'Fix the file or the columns', '', p.counts.invalid ? 'alert' : '')}
    </div>
    <form data-submit="recheckImport" class="mapping">
      <div class="form-grid">
        ${IMPORT_FIELDS.map(([field, label, req]) => `<div class="field"><label>${esc(label)}${req ? ' *' : ''}</label>${col(field)}</div>`).join('')}
        <div class="field"><label>Dates are written</label><select name="dateOrder">
          ${[['DMY', 'Day first (04/10/2026)'], ['MDY', 'Month first (10/04/2026)'], ['YMD', 'Year first (2026-10-04)']].map(([v, l]) => `<option value="${v}" ${m.dateOrder === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Calendar</label><select name="calendar">
          ${[['AD', 'AD (English dates)'], ['BS', 'BS (Nepali dates)']].map(([v, l]) => `<option value="${v}" ${m.calendar === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Bus, when the file has no bus column</label><select name="vehicleId">
          <option value="">Use the bus column</option>
          ${buses.map((b) => `<option value="${esc(b.id)}" ${m.vehicleId === b.id ? 'selected' : ''}>${esc(b.registrationNo)}</option>`).join('')}</select></div>
      </div>
      ${p.missing.length ? `<div class="error" role="alert">Choose the column for: ${p.missing.map(esc).join(', ')}.</div>` : ''}
      <div class="form-actions">
        <button class="btn btn-ghost" type="submit" name="intent" value="check">Check again</button>
        <button class="btn btn-primary" type="submit" name="intent" value="import" ${p.counts.ok && !p.missing.length ? '' : 'disabled'}>Import ${plural(p.counts.ok, 'row')}</button>
      </div>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Line</th><th>Date</th><th>Bus</th><th>Reference</th><th>Tickets</th><th>Net</th><th>Status</th></tr></thead>
      <tbody>${p.rows.map((r) => `<tr>
        <td>${r.line}</td><td>${r.date ? esc(fmtDayBs(r.date)) : '—'}</td><td>${r.busPlate ? `<span class="plate">${esc(r.busPlate)}</span>` : esc(r.plate || '—')}</td>
        <td>${esc(r.reference || '—')}</td><td>${r.tickets}</td><td>${rupees(r.netPaisa)}</td>
        <td>${pill(status[r.status])}${r.errors.length ? `<div class="small error-text">${r.errors.map(esc).join('; ')}</div>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>
    ${p.counts.rows > p.rows.length ? `<p class="hint">Showing the first ${p.rows.length} rows; every row is checked and imported.</p>` : ''}
  </section>`;
}

async function sendImport(path, mapping){
  const f = state.income;
  const fd = new FormData();
  fd.append('file', f.file);
  fd.append('sourceId', f.sourceId);
  if(mapping) fd.append('mapping', JSON.stringify(mapping));
  return api(path, { method: 'POST', body: fd });
}

async function previewImport(form, ev){
  ev.preventDefault();
  const file = form.elements.file.files?.[0];
  if(!file || !form.elements.sourceId.value){ notify('Choose the source and the file.', 'error'); return; }
  Object.assign(state.income, { file, sourceId: form.elements.sourceId.value, preview: null });
  try{
    state.income.preview = await sendImport(`/fleet/companies/${state.companyId}/income/import/preview`);
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function recheckImport(form, ev){
  ev.preventDefault();
  const columns = {};
  for(const [field] of IMPORT_FIELDS){ const v = form.elements[`col-${field}`].value; if(v) columns[field] = v; }
  const mapping = { columns, dateOrder: form.elements.dateOrder.value, calendar: form.elements.calendar.value, vehicleId: form.elements.vehicleId.value || null };
  const intent = ev.submitter?.value || 'check';
  try{
    if(intent === 'import'){
      const done = await sendImport(`/fleet/companies/${state.companyId}/income/import`, mapping);
      Object.assign(state.income, { preview: null, file: null });
      const skipped = [done.duplicates ? `${plural(done.duplicates, 'row')} already entered` : '', done.invalid ? `${plural(done.invalid, 'row')} with problems` : ''].filter(Boolean);
      notify(`Imported ${plural(done.created, 'row')}.${skipped.length ? ` Skipped ${skipped.join(' and ')}.` : ''}`);
    } else {
      state.income.preview = await sendImport(`/fleet/companies/${state.companyId}/income/import/preview`, mapping);
    }
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function undoImport(id){
  const ok = await askDialog({ title: 'Undo this import?', message: 'Every entry it made is removed. The file can be imported again afterwards.', confirmLabel: 'Undo import', danger: true });
  if(!ok) return;
  try{ const r = await api(`/fleet/income/imports/${id}/undo`, { method: 'POST' }); notify(`Removed ${plural(r.removed, 'entry', 'entries')}.`); renderApp(); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/* ================= reports and reconciliation ================= */

function reportQuery(){
  const [from, to] = incomePeriod();
  return new URLSearchParams({ from, to, groupBy: state.income.groupBy, bucket: state.income.bucket });
}

INCOME_TABS.reports = async () => {
  const f = state.income;
  const q = reportQuery();
  const r = await api(`/fleet/companies/${state.companyId}/income/report?${q}`);
  const t = r.totals;
  const pct = (o) => (o == null ? '—' : `${Math.round(o * 100)}%`);
  const head = { bus: 'Bus', route: 'Route', driver: 'Driver' }[r.groupBy];
  // The whole company's series, for the chart over the table.
  const series = new Map();
  r.rows.forEach((row) => row.series.forEach((p) => series.set(p.bucket, (series.get(p.bucket) || 0) + p.netPaisa)));
  const points = [...series.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, netPaisa]) => ({ bucket, netPaisa }));
  return `
    ${periodBar('incomeCustom')}
    <div class="filters">
      <select aria-label="Group by" data-change="incomeOption" data-field="groupBy">
        ${[['bus', 'By bus'], ['route', 'By route'], ['driver', 'By driver’s trips']].map(([v, l]) => `<option value="${v}" ${f.groupBy === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select aria-label="Chart by" data-change="incomeOption" data-field="bucket">
        ${[['day', 'Each day'], ['week', 'Each week'], ['month', 'Each month']].map(([v, l]) => `<option value="${v}" ${f.bucket === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-ghost" data-action="incomeExport" data-format="csv">Download CSV</button>
      <button class="btn btn-sm btn-ghost" data-action="incomeExport" data-format="pdf">Download PDF</button>
    </div>
    <p class="muted small" style="margin:-4px 0 12px">${esc(fmtDay(r.period.from))} – ${esc(fmtDay(r.period.to))} · ${esc(r.period.fromBs)} – ${esc(r.period.toBs)}</p>
    <div class="kpis">
      ${kpi('₨', 'Net income', rupees(t.netPaisa), `${rupees(t.feesPaisa)} in portal fees`)}
      ${kpi('🎫', 'Tickets', num(t.tickets), t.occupancy != null ? `${pct(t.occupancy)} of seats on ${plural(t.trips, 'trip')}` : 'Log trips to see occupancy')}
      ${kpi('🛣', 'Net per km', t.revenuePerKmPaisa != null ? rupees(t.revenuePerKmPaisa) : '—', t.km ? kmText(t.km) : 'Needs odometer readings on trips')}
      ${t.profitPaisa != null ? kpi('📈', 'Operating profit', rupees(t.profitPaisa), `After ${rupees(t.costPaisa)} of recorded costs`, '', t.profitPaisa < 0 ? 'alert' : '') : ''}
    </div>
    ${points.length > 1 ? `<section class="panel"><div class="panel-head"><h2>Net income</h2></div>
      ${columns(points.slice(-31), { value: (p) => p.netPaisa, label: (p) => (f.bucket === 'month' ? monthShort(`${p.bucket}-01`) : p.bucket.slice(5)), text: (p) => shortRupees(p.netPaisa) })}</section>` : ''}
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>${head}</th><th>Tickets</th><th>Trips</th><th>Occupancy</th><th>Km</th><th>Net income</th>
        ${r.groupBy === 'driver' ? '<th>Net per km</th>' : '<th>Costs</th><th>Operating profit</th><th>Net per km</th>'}</tr></thead>
      <tbody>${r.rows.map((x) => `<tr>
        <td><b>${esc(x.label)}</b>${x.detail ? ` <span class="muted small">${esc(x.detail)}</span>` : ''}</td>
        <td>${num(x.tickets)}</td><td>${x.trips}</td><td>${pct(x.occupancy)}</td><td>${x.km ? num(x.km) : '—'}</td><td>${rupees(x.netPaisa)}</td>
        ${r.groupBy === 'driver' ? `<td>${rupees(x.revenuePerKmPaisa)}</td>`
          : `<td title="Fuel ${rupees(x.costs.fuelPaisa)}, maintenance ${rupees(x.costs.maintenancePaisa)}, repairs ${rupees(x.costs.repairsPaisa)}">${rupees(x.costs.totalPaisa)}</td>
             <td class="${x.profitPaisa < 0 ? 'error-text' : ''}">${rupees(x.profitPaisa)}</td><td>${rupees(x.revenuePerKmPaisa)}</td>`}</tr>`).join('')}</tbody>
    </table></div>${r.rows.length ? '' : empty('No income in this period.')}</section>
    <p class="hint">${esc(r.note)}${r.groupBy === 'driver' ? ' Income is placed with a driver through the trip it was entered against; costs belong to buses, so there is no profit by driver.' : ''}</p>`;
};

INCOME_TABS.reconcile = async () => {
  const [from, to] = incomePeriod();
  const r = await api(`/fleet/companies/${state.companyId}/income/reconciliation?${new URLSearchParams({ from, to })}`);
  const flagged = r.perSource.reduce((n, s) => n + s.missingReference, 0);
  return `
    ${periodBar('incomeCustom')}
    ${flagged ? `<div class="banner warn" role="status"><span aria-hidden="true">⚠</span><div><b>${plural(flagged, 'portal entry', 'portal entries')} without a settlement reference.</b>
      Without one it cannot be matched to the portal’s statement, and the same money can be entered twice.</div></div>` : ''}
    <section class="panel"><div class="panel-head"><h2>By source</h2><span class="muted small">Settled with a reference, against unreferenced</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>With a reference</th><th>Without</th><th></th></tr></thead>
        <tbody>${r.perSource.map((s) => `<tr><td><b>${esc(s.name)}</b> <span class="muted small">${esc(SOURCE_KIND[s.kind] || '')}</span></td>
          <td>${rupees(s.referenced.netPaisa)} <span class="muted small">(${s.referenced.count})</span></td>
          <td>${rupees(s.unreferenced.netPaisa)} <span class="muted small">(${s.unreferenced.count})</span></td>
          <td>${s.missingReference ? pill([`${s.missingReference} missing a reference`, 'warn']) : ''}</td></tr>`).join('')}</tbody>
      </table></div>${r.perSource.length ? '' : empty('No income in this period.')}</section>
    <section class="panel"><div class="panel-head"><h2>By day</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Day</th><th>Settled (with reference)</th><th>Cash without reference</th><th>Online portals</th><th></th></tr></thead>
        <tbody>${r.perDay.slice().reverse().map((d) => `<tr><td>${esc(fmtDayBs(d.day))}</td><td>${rupees(d.settledPaisa)}</td>
          <td>${rupees(d.unreferencedCashPaisa)}</td><td>${rupees(d.portalPaisa)}</td>
          <td>${d.portalMissingReference ? pill([`${d.portalMissingReference} without reference`, 'warn']) : ''}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
};

INCOME_TABS.sources = async () => {
  const sources = await api(`/fleet/companies/${state.companyId}/income/sources`);
  state.records.sources = sources;
  return `<section class="panel">
    <div class="panel-head"><h2>Income sources</h2><button class="btn btn-sm btn-primary" data-action="addIncomeSource">+ Add a source</button></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Kind</th><th>Status</th><th>Saved import columns</th><th></th></tr></thead>
      <tbody>${sources.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(SOURCE_KIND[s.kind])}</td>
        <td>${s.isActive ? pill(['In use', 'good']) : pill(['Not in use', ''])}</td>
        <td>${s.importMapping ? 'Yes' : '<span class="muted">—</span>'}</td>
        <td><button class="link" data-action="editIncomeSource" data-id="${esc(s.id)}">Edit</button></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="hint">A source that is no longer used can be switched off; its past income stays in the reports.</p>
  </section>`;
};

const sourceFields = (edit) => [
  { name: 'name', label: 'Name', required: true, maxlength: 60, full: true },
  { name: 'kind', label: 'Kind', type: 'select', options: Object.entries(SOURCE_KIND) },
  ...(edit ? [{ name: 'isActive', label: 'In use', type: 'checkbox' }] : []),
];

async function addIncomeSource(){
  const saved = await openForm({
    title: 'Add an income source', fields: sourceFields(false), values: { kind: 'PORTAL' },
    onSubmit: (v) => api(`/fleet/companies/${state.companyId}/income/sources`, { method: 'POST', body: v }),
  });
  if(saved){ notify(`${saved.name} added.`); renderApp(); }
}

async function editIncomeSource(id){
  const s = state.records.sources?.find((x) => x.id === id);
  if(!s) return;
  const saved = await openForm({
    title: `Edit ${s.name}`, fields: sourceFields(true), values: s,
    onSubmit: (v) => api(`/fleet/income/sources/${id}`, { method: 'PATCH', body: v }),
  });
  if(saved){ notify('Saved.'); renderApp(); }
}

function incomeExport(format){
  downloadFile(`/fleet/companies/${state.companyId}/income/report.${format}?${reportQuery()}`);
}

/* ================= turning income records on (Company page) ================= */

/** The Company page's panel: off, how to turn it on; on, the owner's switches. */
function financePanel(){
  const f = state.company.finance;
  if(!f?.enabled){
    return `<section class="panel"><div class="panel-head"><h2>Income records</h2>${pill(['Off', ''])}</div>
      <p>Record what each bus earns each day, from the counter, on board and through Bussewa, eSewa or Khalti, and see
        profit per bus after fuel, maintenance and repairs.</p>
      ${isOwner() ? `<p class="hint">Turning this on needs an authenticator app (such as Google Authenticator) on your phone.
        From then on your sign-in asks for its code, because this account can see the company’s money.</p>
        <button class="btn btn-primary" data-action="enableFinance">Turn on income records</button>`
        : '<p class="hint">The company owner can turn this on.</p>'}
    </section>`;
  }
  return `<section class="panel"><div class="panel-head"><h2>Income records</h2>${pill(['On', 'good'])}</div>
    <p><a href="#income">Open income →</a></p>
    ${isOwner() ? `<label class="check"><input type="checkbox" data-change="shareTotals" ${f.managersSeeTotals ? 'checked' : ''}>
      Managers can see totals, reports and reconciliation</label>
      <p class="hint">Managers can always record income. Without this they never see a total.</p>
      <button class="btn btn-ghost btn-sm" data-action="disableFinance">Turn income records off</button>` : ''}
  </section>`;
}

async function enableFinance(){
  try{
    const settings = await api(`/fleet/companies/${state.companyId}/finance`);
    let code = null;
    let codes = null;
    if(!settings.authenticatorReady){
      const setup = await api('/auth/mfa/setup', { method: 'POST' });
      // The QR is drawn by Batoma's own API from the otpauth link; nothing else goes in.
      const qr = /^<svg[\s\S]*<\/svg>\s*$/.test(setup.qrSvg) && !/<script|on\w+=/i.test(setup.qrSvg) ? setup.qrSvg : '';
      code = await openForm({
        title: 'Set up your authenticator', submitLabel: 'Confirm and turn on',
        intro: 'Scan the code with Google Authenticator, Authy or Microsoft Authenticator, then type the 6-digit code it shows.',
        html: `<div class="mfa-setup">${qr ? `<div class="qr" aria-hidden="true">${qr}</div>` : ''}
          <p class="small">On this phone? <a href="${esc(setup.otpauthUri)}">Open in your authenticator app</a>, or type this key:
          <code class="secret">${esc(setup.secret.replace(/(.{4})/g, '$1 ').trim())}</code></p></div>`,
        fields: [{ name: 'code', label: '6-digit code', required: true, maxlength: 6, placeholder: '123456', full: true }],
        onSubmit: async (v) => { codes = (await api('/auth/mfa/setup/confirm', { method: 'POST', body: { code: v.code } })).recoveryCodes; return v.code; },
      });
      if(!code) return;
      if(codes?.length) await showRecoveryCodes(codes);
    } else {
      code = await askDialog({
        title: 'Turn on income records', confirmLabel: 'Turn on',
        message: 'Enter the current code from your authenticator app.',
        field: { label: '6-digit code', maxlength: 6, placeholder: '123456', required: true },
      });
      if(!code) return;
    }
    await api(`/fleet/companies/${state.companyId}/finance`, { method: 'PATCH', body: { enabled: true, code } });
    state.company = await api(`/fleet/companies/${state.companyId}`);
    renderShell();
    notify('Income records are on. Your sign-in will now ask for the authenticator code.');
    go('income');
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function disableFinance(){
  const ok = await askDialog({ title: 'Turn income records off?', message: 'Nobody can enter or see income until it is turned on again. What is recorded is kept.', confirmLabel: 'Turn off', danger: true });
  if(!ok) return;
  try{
    await api(`/fleet/companies/${state.companyId}/finance`, { method: 'PATCH', body: { enabled: false } });
    state.company = await api(`/fleet/companies/${state.companyId}`);
    renderShell(); renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function shareTotals(el){
  try{
    await api(`/fleet/companies/${state.companyId}/finance`, { method: 'PATCH', body: { managersSeeTotals: el.checked } });
    state.company = await api(`/fleet/companies/${state.companyId}`);
    notify(el.checked ? 'Managers can now see totals.' : 'Totals are now for owners only.');
  }catch(err){ el.checked = !el.checked; if(!err.silent) notify(err.message, 'error'); }
}
