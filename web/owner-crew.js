/* Batoma for bus owners: driver scorecards, appraisals and the leaderboard.

   A scorecard turns the reviews of a crew member's trips, their fuel, incidents and
   licence into one page for any period. Passenger scores are adjusted towards the
   company average and stay unranked below 10 reviews, so a handful of reviews can
   neither make nor break anyone. An appraisal starts from what the scorecard suggests;
   the owner or manager confirms or changes every score. Dates show BS beside AD. */
'use strict';

/** Criterion → English and Nepali label, as on the printed appraisal. */
const CRITERIA = [
  ['driving', 'Passenger driving score', 'यात्रुले दिएको चालक अंक'],
  ['punctuality', 'Punctuality', 'समयपालन'],
  ['conduct', 'Conduct', 'आचरण'],
  ['safety', 'Safety record', 'सुरक्षा रेकर्ड'],
  ['vehicleCare', 'Vehicle care', 'सवारी साधनको हेरचाह'],
  ['attendance', 'Attendance', 'हाजिरी'],
];
const SCORE_FIELD = {
  driving: 'drivingScore', punctuality: 'punctualityScore', conduct: 'conductScore',
  safety: 'safetyScore', vehicleCare: 'vehicleCareScore', attendance: 'attendanceScore',
};
const OUTCOME = {
  NONE: ['No action', ''], COMMENDATION: ['Commendation', 'good'], BONUS: ['Bonus', 'good'],
  TRAINING: ['Training', 'warn'], WARNING: ['Warning', 'bad'],
};
const APPRAISAL_STATUS = { DRAFT: ['Draft', 'warn'], FINAL: ['Final', 'good'] };
const METRIC_LABEL = { overall: 'Overall', driving: 'Safe driving', punctuality: 'On time', staff: 'Staff' };

state.scorecard = { range: '90', from: '', to: '' };

/** The period presets an owner asks for, in Kathmandu days; the Nepali month ones use the BS calendar. */
function scorecardPeriod(){
  const f = state.scorecard;
  const today = ktmToday();
  if(f.range === 'custom' && f.from && f.to) return [f.from, f.to];
  if((f.range === 'bsmonth' || f.range === 'lastbsmonth' || f.range === 'bsyear') && window.BsDate){
    const bs = BsDate.adToBs(today);
    if(bs){
      if(f.range === 'bsyear') return [BsDate.bsToAd(bs.year, 1, 1), today];
      let { year, month } = bs;
      if(f.range === 'lastbsmonth'){ month -= 1; if(month < 1){ month = 12; year -= 1; } }
      const first = BsDate.bsToAd(year, month, 1);
      const last = BsDate.bsToAd(year, month, BsDate.daysInBsMonth(year, month));
      if(first && last) return [first, last > today ? today : last];
    }
  }
  return [shiftDay(today, -89), today];
}

function periodFilters(){
  const f = state.scorecard;
  const [from, to] = scorecardPeriod();
  const bs = window.BsDate?.adToBs(ktmToday());
  const lastMonth = bs ? BsDate.BS_MONTHS_EN[(bs.month + 10) % 12] : 'Last month';
  const presets = [['90', 'Last 90 days'], ['bsmonth', bsMonthLabel()], ['lastbsmonth', lastMonth], ['bsyear', bs ? `Year ${bs.year}` : 'This year']];
  return `<form class="filters" data-submit="scorecardCustom" aria-label="Period">
    ${presets.map(([k, l]) => `<button type="button" class="btn btn-sm ${f.range === k ? 'btn-primary' : 'btn-ghost'}" data-action="scorecardRange" data-range="${k}">${esc(l)}</button>`).join('')}
    <label class="inline">From <input type="date" name="from" value="${esc(from)}" max="${esc(ktmToday())}"></label>
    <label class="inline">To <input type="date" name="to" value="${esc(to)}" max="${esc(ktmToday())}"></label>
    <button class="btn btn-sm btn-ghost" type="submit">Show</button>
  </form>`;
}

const score1 = (n) => n == null ? '—' : Number(n).toFixed(1);
const periodText = (p) => `${fmtDay(p.from)} – ${fmtDay(p.to)} · ${esc(p.fromBs)} – ${esc(p.toBs)}`;

/* ================= one crew member ================= */

SCREENS.driver = async ({ id, tab = 'scorecard' }) => {
  const [from, to] = scorecardPeriod();
  const [card, appraisals] = await Promise.all([
    api(`/fleet/drivers/${id}/scorecard?${new URLSearchParams({ from, to })}`),
    api(`/fleet/drivers/${id}/appraisals`),
  ]);
  state.records.scorecard = card;
  const d = card.driver;
  const tabs = [['scorecard', 'Scorecard'], ['appraisals', 'Appraisals', appraisals.length]];
  const body = tab === 'appraisals' ? appraisalList(d, appraisals) : scorecardBody(card);
  return `
    <p class="crumbs"><a href="#crew">← Crew</a>${isOwner() ? ' · <a href="#leaderboard">Leaderboard</a>' : ''}</p>
    ${pageHead(d.name, `${esc(DRIVER_ROLE[d.role])}${d.isActive ? '' : ' · no longer with the company'}`,
      canManage() ? `<button class="btn btn-primary" data-action="newAppraisal" data-id="${esc(d.id)}">+ Appraisal for this period</button>` : '')}
    <nav class="tabs" role="tablist" aria-label="Crew member">
      ${tabs.map(([k, label, count]) => `<a role="tab" href="#driver/${esc(d.id)}/${k}" aria-selected="${k === tab}">${label}${count != null ? `<small>${count}</small>` : ''}</a>`).join('')}
    </nav>
    <div role="tabpanel">${body}</div>`;
};

function scorecardBody(card){
  const p = card.passengers;
  const o = p.scores.overall;
  const f = card.fuel;
  const lic = card.driver.licence;
  const isDriver = card.driver.role === 'DRIVER';
  const praise = card.comments.praise;
  const complaints = card.comments.complaints;
  return `
    ${periodFilters()}
    <p class="muted small" style="margin:-4px 0 12px">${periodText(card.period)}</p>
    <div class="kpis">
      ${kpi('★', 'Passenger score', p.enough ? score1(o.adjusted) : '—',
        p.enough ? `${plural(p.reviews, 'review')}, adjusted · company ${score1(o.companyMean)}`
          : `<b>Not enough reviews yet</b> · ${plural(p.reviews, 'review')} (10 needed)`)}
      ${kpi('🚌', 'Trips', num(card.trips.trips), card.trips.km ? `${kmText(card.trips.km)} on ${plural(card.trips.tripsWithKm, 'trip')} with odometer readings` : 'No odometer readings')}
      ${isDriver ? kpi('⛽', 'Fuel', f.kmPerLitre != null ? `${f.kmPerLitre} km/l` : '—',
        f.kmPerLitre != null ? `Same buses ${f.sameBusesKmPerLitre ?? '—'} · company ${f.companyKmPerLitre ?? '—'} km/l` : 'Needs odometer readings and full-tank fills') : ''}
      ${kpi('⚠', 'Incidents', num(card.incidents.total), `${plural(card.incidents.accidents, 'accident')} · ${plural(card.incidents.breakdowns, 'breakdown')}`, '', card.incidents.accidents ? 'alert' : '')}
      ${kpi('🪪', 'Licence', esc(EXPIRY[lic.state][0]), lic.expiresAt ? fmtDayBs(lic.expiresAt) : 'No expiry date recorded', '', lic.state === 'EXPIRED' ? 'alert' : '')}
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Passenger scores</h2>
          <a class="small" href="#feedback" data-action="driverReviews" data-id="${esc(card.driver.id)}">Read the reviews →</a></div>
        <div class="table-wrap"><table style="min-width:360px">
          <thead><tr><th>Score</th><th>Adjusted</th><th>Plain average</th><th>Reviews</th><th>Company</th></tr></thead>
          <tbody>${['overall', 'driving', 'punctuality', 'staff'].map((k) => {
            const s = p.scores[k];
            return `<tr><td><b>${METRIC_LABEL[k]}</b></td>
              <td>${s.enough ? `<b>${score1(s.adjusted)}</b>` : `<span class="muted">${score1(s.adjusted)}</span>`}</td>
              <td>${score1(s.mean)}</td><td>${s.n}</td><td>${score1(s.companyMean)}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="hint">${p.enough ? '' : '<b>Not enough reviews yet.</b> '}Adjusted scores lean towards the company average until a crew member has plenty of reviews; grey ones rest on fewer than 10.
          ${p.reviews ? `${plural(p.fromTrips, 'review')} came from a logged trip, the rest from the bus’s roster at the time.` : ''}</p>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>By month</h2><span class="muted small">Plain average, out of 5</span></div>
        ${card.trend.length ? columns(card.trend, {
          value: (t) => t.overall, max: 5,
          label: (t) => `${monthShort(`${t.month}-01`)}`, text: (t) => `${score1(t.overall)} (${t.reviews})`,
        }) + `<p class="muted small">${card.trend.map((t) => `${monthShort(`${t.month}-01`)}: ${esc(t.bs || '')}`).join(' · ')}</p>` : empty('No reviews in this period.')}
      </section>
    </div>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>What passengers mention</h2><span class="muted small">Reviews mentioning each, English and Nepali</span></div>
        ${praise.length ? `<div class="words">${praise.map((w) => `<span class="word good">${esc(w.label)}<b>${w.count}</b></span>`).join('')}</div>` : '<p class="muted small">No praise themes yet.</p>'}
        ${complaints.length ? `<div class="words" style="margin-top:10px">${complaints.map((w) => `<span class="word bad">${esc(w.label)}<b>${w.count}</b></span>`).join('')}</div>` : '<p class="muted small">No complaint themes.</p>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>What the data suggests</h2><span class="muted small">For an appraisal of this period</span></div>
        ${suggestionList(card.suggestions)}
      </section>
    </div>
    <p class="hint">${card.method.notes.map(esc).join(' ')}</p>`;
}

function suggestionList(s, chosen){
  return `<ul class="suggestions">${CRITERIA.map(([k, en, ne]) => {
    const sug = s?.[k];
    return `<li><div><b>${esc(en)}</b> <span class="muted small" lang="ne">${esc(ne)}</span>
      <div class="muted small">${esc(sug?.basis || '')}</div></div>
      <span class="sug">${chosen ? `${chosen[k] ?? '—'}` : sug?.value != null ? `${sug.value}` : '—'}<small>/5</small></span></li>`;
  }).join('')}</ul>`;
}

function appraisalList(d, items){
  return items.length ? `<section class="panel"><div class="table-wrap"><table>
    <thead><tr><th>Period</th><th>Status</th><th>Average</th><th>Outcome</th><th>Discussed</th><th>By</th></tr></thead>
    <tbody>${items.map((a) => `<tr class="row-link" data-action="go" data-to="appraisal/${esc(a.id)}">
      <td><b>${fmtDay(a.period.from)} – ${fmtDay(a.period.to)}</b><div class="muted small">${esc(a.period.fromBs)} – ${esc(a.period.toBs)}</div></td>
      <td>${pill(APPRAISAL_STATUS[a.status])}</td>
      <td>${a.average != null ? `${a.average} / 5` : '—'}</td>
      <td>${pill(OUTCOME[a.outcome])}</td>
      <td>${a.acknowledgedAt ? fmtDayBs(a.acknowledgedAt) : '<span class="muted">Not yet</span>'}</td>
      <td>${esc(a.appraiser || '—')}</td></tr>`).join('')}</tbody></table></div></section>`
    : `<section class="panel">${empty(`No appraisals of ${d.name} yet.`)}
      ${canManage() ? `<p class="hint">An appraisal starts with the scores the data suggests for the period you choose. You confirm or change each one.</p>` : ''}</section>`;
}

/** The Crew page's view of every appraisal: drafts waiting to be finalised first. */
function appraisalsPanel(items){
  if(!items.length) return '';
  const drafts = items.filter((a) => a.status === 'DRAFT');
  const undiscussed = items.filter((a) => a.status === 'FINAL' && !a.acknowledgedAt);
  const shown = [...drafts, ...undiscussed, ...items.filter((a) => a.status === 'FINAL' && a.acknowledgedAt)].slice(0, 8);
  return `<section class="panel">
    <div class="panel-head"><h2>Appraisals</h2><span class="muted small">${[
      drafts.length ? plural(drafts.length, 'draft') : '',
      undiscussed.length ? `${undiscussed.length} not yet discussed` : '',
    ].filter(Boolean).join(' · ') || plural(items.length, 'appraisal')}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Crew member</th><th>Period</th><th>Status</th><th>Average</th><th>Outcome</th></tr></thead>
      <tbody>${shown.map((a) => `<tr class="row-link" data-action="go" data-to="appraisal/${esc(a.id)}">
        <td><b>${esc(a.driver.name)}</b></td>
        <td>${fmtDay(a.period.from)} – ${fmtDay(a.period.to)}<div class="muted small">${esc(a.period.fromBs)} – ${esc(a.period.toBs)}</div></td>
        <td>${pill(APPRAISAL_STATUS[a.status])}${a.status === 'FINAL' && !a.acknowledgedAt ? ' <span class="muted small">not discussed</span>' : ''}</td>
        <td>${a.average != null ? `${a.average} / 5` : '—'}</td><td>${pill(OUTCOME[a.outcome])}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

async function newAppraisal(driverId){
  const [from, to] = scorecardPeriod();
  const created = await openForm({
    title: 'New appraisal', submitLabel: 'Start appraisal',
    intro: 'Scores start from what trips, fuel, incidents and passenger reviews in this period suggest. You can change every one before finalising.',
    fields: [
      { name: 'periodStart', label: 'From', type: 'date', required: true },
      { name: 'periodEnd', label: 'To', type: 'date', required: true },
    ],
    values: { periodStart: from, periodEnd: to },
    onSubmit: (v) => api(`/fleet/drivers/${driverId}/appraisals`, { method: 'POST', body: v }),
  });
  if(created){ notify('Draft appraisal started.'); go(`appraisal/${created.id}`); }
}

/* ================= one appraisal ================= */

SCREENS.appraisal = async ({ id }) => {
  const a = await api(`/fleet/appraisals/${id}`);
  state.records.appraisal = a;
  const editable = a.status === 'DRAFT' && canManage();
  const sug = a.suggested?.criteria || {};
  const sum = a.suggested?.summary;
  const actions = [
    `<button class="btn btn-ghost" data-action="appraisalPdf" data-id="${esc(a.id)}">Download PDF</button>`,
    editable ? `<button class="btn btn-danger" data-action="deleteAppraisal" data-id="${esc(a.id)}">Delete draft</button>` : '',
    a.status === 'FINAL' && !a.acknowledgedAt && canManage() ? `<button class="btn btn-primary" data-action="acknowledgeAppraisal" data-id="${esc(a.id)}">Discussed with ${esc(a.driver.name)}</button>` : '',
  ].join('');
  return `
    <p class="crumbs"><a href="#driver/${esc(a.driver.id)}/appraisals">← ${esc(a.driver.name)}</a></p>
    ${pageHead(`Appraisal: ${a.driver.name}`, `${periodText(a.period)} · ${pill(APPRAISAL_STATUS[a.status])}`, actions)}
    ${a.status === 'FINAL' ? `<div class="banner" role="status"><span aria-hidden="true">🔒</span><div><b>Final.</b> Finalised ${fmtDayBs(a.finalisedAt)}${a.appraiser ? ` by ${esc(a.appraiser)}` : ''}.
      ${a.acknowledgedAt ? `Discussed with ${esc(a.driver.name)} on ${fmtDayBs(a.acknowledgedAt)}.` : 'Not yet discussed with the crew member.'}
      A final appraisal can’t be changed; start a new one for a new period.</div></div>` : ''}
    ${sum ? `<div class="kpis">
      ${kpi('★', 'Passenger score', sum.enoughReviews ? score1(sum.overall) : '—', sum.enoughReviews ? plural(sum.reviews, 'review') : `Not enough reviews yet (${sum.reviews})`)}
      ${kpi('🚌', 'Trips', num(sum.trips), sum.km ? kmText(sum.km) : 'No odometer readings')}
      ${kpi('⛽', 'Fuel', sum.kmPerLitre != null ? `${sum.kmPerLitre} km/l` : '—', sum.sameBusesKmPerLitre != null ? `Same buses ${sum.sameBusesKmPerLitre} km/l` : 'Not measured')}
      ${kpi('⚠', 'Accidents', num(sum.accidents), plural(sum.breakdowns, 'breakdown'))}
    </div>` : ''}
    ${editable ? appraisalForm(a, sug) : appraisalReadOnly(a, sug)}`;
};

function scorePicker(field, value){
  return `<div class="score-pick" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => `
    <label><input type="radio" name="${field}" value="${n}" ${value === n ? 'checked' : ''}><span>${n}</span></label>`).join('')}
    <label class="clear"><input type="radio" name="${field}" value="" ${value == null ? 'checked' : ''}><span>—</span></label></div>`;
}

function appraisalForm(a, sug){
  return `<form class="panel appraisal" data-submit="saveAppraisal" data-id="${esc(a.id)}">
    <div class="panel-head"><h2>Scores</h2><span class="muted small">1 is poor, 5 is excellent</span></div>
    ${CRITERIA.map(([k, en, ne]) => `<fieldset class="criterion">
      <legend><b>${esc(en)}</b> <span class="muted" lang="ne">${esc(ne)}</span></legend>
      ${scorePicker(SCORE_FIELD[k], a.scores[k])}
      <div class="muted small">${sug[k] ? `Data: ${sug[k].value != null ? `suggests <b>${sug[k].value}</b>.` : 'no suggestion.'} ${esc(sug[k].basis)}` : ''}</div>
    </fieldset>`).join('')}
    <div class="form-grid">
      <label class="full">Strengths <span class="muted" lang="ne">सबल पक्ष</span><textarea name="strengths" rows="3" maxlength="2000">${esc(a.strengths || '')}</textarea></label>
      <label class="full">Goals for the next period <span class="muted" lang="ne">आगामी लक्ष्य</span><textarea name="goals" rows="3" maxlength="2000">${esc(a.goals || '')}</textarea></label>
      <label class="full">Comments <span class="muted" lang="ne">टिप्पणी</span><textarea name="comments" rows="4" maxlength="4000">${esc(a.comments || '')}</textarea></label>
      <label>Outcome <span class="muted" lang="ne">नतिजा</span>
        <select name="outcome">${Object.entries(OUTCOME).map(([k, [l]]) => `<option value="${k}" ${a.outcome === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" type="submit" name="intent" value="save">Save draft</button>
      <button class="btn btn-primary" type="submit" name="intent" value="finalise">Save and finalise</button>
    </div>
    <p class="hint">Finalising needs a score for every criterion and can’t be undone. Changes are recorded in the company’s audit trail.</p>
  </form>`;
}

function appraisalReadOnly(a, sug){
  const text = (label, ne, v) => `<div class="fact"><b style="font-size:15px;white-space:pre-wrap">${v ? esc(v) : '<span class="muted">—</span>'}</b>${esc(label)} · <span lang="ne">${esc(ne)}</span></div>`;
  return `<section class="panel">
      <div class="panel-head"><h2>Scores</h2><span class="muted small">Average ${a.average != null ? `${a.average} / 5` : '—'}</span></div>
      ${suggestionList(sug, a.scores)}
    </section>
    <section class="panel"><div class="facts" style="grid-template-columns:1fr">
      ${text('Strengths', 'सबल पक्ष', a.strengths)}${text('Goals for the next period', 'आगामी लक्ष्य', a.goals)}
      ${text('Comments', 'टिप्पणी', a.comments)}
      <div class="fact">${pill(OUTCOME[a.outcome])} Outcome · <span lang="ne">नतिजा</span></div>
    </div></section>`;
}

async function saveAppraisal(form, ev){
  ev.preventDefault();
  const id = form.dataset.id;
  const intent = ev.submitter?.value || 'save';
  const fd = new FormData(form);
  const body = {
    strengths: fd.get('strengths') || '', goals: fd.get('goals') || '', comments: fd.get('comments') || '',
    outcome: fd.get('outcome'),
  };
  for(const field of Object.values(SCORE_FIELD)) body[field] = fd.get(field) ? Number(fd.get(field)) : null;
  try{
    await api(`/fleet/appraisals/${id}`, { method: 'PATCH', body });
    if(intent === 'finalise'){
      const ok = await askDialog({
        title: 'Finalise this appraisal?', confirmLabel: 'Finalise',
        message: 'A final appraisal can’t be changed. You can still download it and record when you discussed it with the crew member.',
      });
      if(!ok){ notify('Draft saved.'); renderApp(); return; }
      await api(`/fleet/appraisals/${id}/finalise`, { method: 'POST' });
      notify('Appraisal finalised.');
    } else {
      notify('Draft saved.');
    }
    renderApp();
  }catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function acknowledgeAppraisal(id){
  const a = state.records.appraisal;
  const ok = await askDialog({
    title: `Discussed with ${a?.driver.name || 'the crew member'}?`, confirmLabel: 'Record it',
    message: 'Records today as the day you went through this appraisal with them. It shows on the printed copy.',
  });
  if(!ok) return;
  try{ await api(`/fleet/appraisals/${id}/acknowledge`, { method: 'POST' }); notify('Recorded.'); renderApp(); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

async function deleteAppraisal(id){
  const a = state.records.appraisal;
  const ok = await askDialog({ title: 'Delete this draft?', message: 'The draft and its notes are removed.', confirmLabel: 'Delete', danger: true });
  if(!ok) return;
  try{ await api(`/fleet/appraisals/${id}`, { method: 'DELETE' }); notify('Draft deleted.'); go(`driver/${a.driver.id}/appraisals`); }
  catch(err){ if(!err.silent) notify(err.message, 'error'); }
}

/* ================= leaderboard (owners only) ================= */

SCREENS.leaderboard = async () => {
  if(!isOwner()){
    return `${pageHead('Leaderboard', '')}<section class="panel">${empty('Only a company owner can see the drivers’ leaderboard.')}</section>`;
  }
  const [from, to] = scorecardPeriod();
  const board = await api(`/fleet/companies/${state.companyId}/leaderboard?${new URLSearchParams({ from, to })}`);
  const ranked = board.rows.filter((r) => r.rank != null);
  const rest = board.rows.filter((r) => r.rank == null);
  const row = (r) => `<tr class="row-link" data-action="go" data-to="driver/${esc(r.driverId)}">
    <td>${r.rank != null ? `<b>${r.rank}</b>` : '<span class="muted">—</span>'}</td>
    <td><b>${esc(r.name)}</b>${r.isActive ? '' : ' <span class="muted small">(left)</span>'}</td>
    <td>${r.enough ? `<span class="stars">${stars(r.adjusted)}</span> <b>${score1(r.adjusted)}</b>` : `<span class="muted small">Not enough reviews yet</span>`}</td>
    <td>${r.reviews}</td><td>${score1(r.driving)}</td><td>${num(r.trips)}</td><td>${r.km ? kmText(r.km) : '—'}</td>
    <td>${r.kmPerLitre ?? '—'}</td><td>${r.accidents || '—'}</td></tr>`;
  return `
    <p class="crumbs"><a href="#crew">← Crew</a></p>
    ${pageHead('Drivers’ leaderboard', periodText(board.period))}
    ${periodFilters()}
    <div class="banner" role="note"><span aria-hidden="true">ℹ</span><div>${esc(board.caveat)}</div></div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Rank</th><th>Driver</th><th>Passenger score</th><th>Reviews</th><th>Driving</th><th>Trips</th><th>Distance</th><th>km/l</th><th>Accidents</th></tr></thead>
      <tbody>${ranked.map(row).join('')}
        ${rest.length ? `<tr><td colspan="9" class="muted small" style="padding-top:14px">Not ranked: fewer than 10 reviews in this period</td></tr>${rest.map(row).join('')}` : ''}
      </tbody></table></div>
      ${board.rows.length ? '' : empty('No drivers yet.')}
    </section>
    <p class="hint">Company average ${board.companyOverall != null ? `${board.companyOverall} out of 5` : 'not available yet'}. Only you, as an owner, can see this page.</p>`;
};

function scorecardRange(range){
  state.scorecard.range = range;
  renderApp();
}

function scorecardCustom(form, ev){
  ev.preventDefault();
  const from = form.elements.from.value;
  const to = form.elements.to.value;
  if(!from || !to || from > to){ notify('Choose a start date on or before the end date.', 'error'); return; }
  Object.assign(state.scorecard, { range: 'custom', from, to });
  renderApp();
}

function driverReviews(id){
  Object.assign(state.feedback, { driverId: id, busId: '', rating: '', days: '', page: 1 });
}
