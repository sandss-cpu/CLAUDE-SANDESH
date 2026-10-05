/* ===========================================================================
   The public website, from the control panel: partner packages (what each partner
   has bought, for how long and at what price), the enquiry inbox (contact and
   advertising messages from the website) and the newsletter list.

   A classic script loaded after admin.js, sharing its globals (state, api, esc,
   notify, askDialog, renderMain, downloadFile, SECTIONS, SCREENS, Actions). Prices
   are entered in rupees and kept in paisa. Every change is audited by the API.
   =========================================================================== */

state.site = {
  tab: 'listings', packages: [], pkgStatus: '', businesses: [], editing: null, pending: null,
  enquiries: null, enqStatus: 'NEW', enqPage: 1, newsletter: null,
};

const PACKAGE_KIND = {
  LISTING: 'Featured listing', HOME_HERO: 'Home page spotlight', SECTION_SPONSOR: 'Section partner', SPONSORED_ARTICLE: 'Sponsored story',
  DESTINATION_SPONSOR: 'Place partner', DEALS: 'Featured deal', NEWSLETTER: 'Newsletter partner',
};
const PACKAGE_STATUS = { PROPOSED: 'Proposed', ACTIVE: 'Active', PAUSED: 'Paused', ENDED: 'Ended', CANCELLED: 'Cancelled' };
const PACKAGE_TONE = { PROPOSED: 'PENDING', ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', ENDED: 'ARCHIVED', CANCELLED: 'REJECTED' };
const ENQUIRY_KIND = { ADVERTISE: 'Advertising', CONTACT: 'Message' };
const TIER_LABEL = { FREE: 'Free', VERIFIED: 'Verified', FEATURED: 'Featured', PREMIUM: 'Premium' };
const BIZ_CATEGORY = {
  HOTEL: 'Hotel', HOMESTAY: 'Homestay', LODGE: 'Lodge', RESTAURANT: 'Restaurant', CAFE: 'Café', TREKKING_AGENCY: 'Trekking agency',
  ADVENTURE: 'Adventure', PARAGLIDING: 'Paragliding', RENTAL: 'Rentals', GUIDE: 'Guide', HANDICRAFT: 'Handicrafts', TOUR_OPERATOR: 'Tours', TRANSPORT: 'Transport',
};

const nprFromPaisa = (p) => (p == null ? '—' : `NPR ${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const dayBoth = (d) => { const bs = window.BsDate?.formatBs?.(new Date(d).toISOString().slice(0, 10)); return bs ? `${fmtDay(d)} · ${bs}` : fmtDay(d); };
/** A date input's value, read as the start (or end) of that day in Kathmandu. */
const nptDay = (v, end) => (v ? new Date(`${v}T${end ? '23:59:59' : '00:00:00'}+05:45`).toISOString() : '');
const toDayInput = (iso) => (iso ? new Date(new Date(iso).getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10) : '');

async function screenWebsite(){
  const s = state.site;
  const tabs = [['listings', 'Listings'], ['packages', 'Partner packages'], ['enquiries', 'Enquiries'], ['newsletter', 'Newsletter']];
  let body = '';
  if(s.tab === 'listings') body = await siteListings();
  else if(s.tab === 'packages') body = await sitePackages();
  else if(s.tab === 'enquiries') body = await siteEnquiries();
  else body = await siteNewsletter();
  return `
    <div class="top-row"><h2>Website</h2>
      ${s.tab === 'packages' ? '<button class="btn btn-primary" data-action="siteNewPackage">+ New package</button>' : ''}</div>
    <div class="filters" role="tablist" aria-label="Website">
      ${tabs.map(([k, label]) => `<button class="btn btn-sm ${s.tab === k ? 'btn-primary' : ''}" role="tab" aria-selected="${s.tab === k}" data-action="siteTab" data-tab="${k}">${label}</button>`).join('')}
    </div>
    ${body}
    ${s.editing ? packageForm(s.editing) : ''}`;
}

/** Verification is manual: nothing unverified reaches the website. Then the tier a partner pays for. */
async function siteListings(){
  const s = state.site;
  const [pending, list] = await Promise.all([api('/businesses/admin/pending-verification?limit=50'), api('/businesses?limit=100')]);
  s.pending = pending.items || [];
  s.businesses = list.items || [];
  const waiting = new Set(s.pending.map((b) => b.id));
  return `
    <h3>Waiting for verification</h3>
    <p class="hint">Check that the business exists, is where it says, and that the person who listed it runs it. Only then verify it: it then appears on the website and can be sold packages.</p>
    ${!s.pending.length ? '<div class="empty">Nothing waiting.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Business</th><th>Listed by</th><th>Contact</th><th>Listed</th><th></th></tr></thead>
        <tbody>${s.pending.map((b) => `<tr>
          <td><strong>${esc(b.name)}</strong><br><small>${esc(BIZ_CATEGORY[b.category] || b.category)}${b.district ? ` · ${esc(b.district)}` : ''}</small>
            ${b.description ? `<div class="hint">${esc(b.description.slice(0, 160))}</div>` : ''}</td>
          <td>${esc(b.owner?.name || '—')}${b.owner?.phone ? `<br><small>${esc(b.owner.phone)}</small>` : ''}</td>
          <td>${esc(b.phone || '—')}${b.website ? `<br><small>${esc(b.website)}</small>` : ''}${b.latitude != null ? '<br><small>Has a map pin</small>' : ''}</td>
          <td>${esc(dayBoth(b.createdAt))}</td>
          <td class="row-actions"><button class="btn btn-sm btn-primary" data-action="siteVerify" data-id="${b.id}" data-name="${esc(b.name)}">Verify…</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    <h3 class="site-gap">Partners</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Business</th><th>Tier</th><th></th></tr></thead>
      <tbody>${s.businesses.map((b) => `<tr>
        <td><strong>${esc(b.name)}</strong><br><small>${esc(BIZ_CATEGORY[b.category] || b.category)}${b.district ? ` · ${esc(b.district)}` : ''}</small></td>
        <td>${waiting.has(b.id) ? '<span class="pill PENDING">Not verified</span>' : `<span class="pill ${b.tier === 'FREE' ? '' : 'ACTIVE'}">${TIER_LABEL[b.tier] || b.tier}</span>`}</td>
        <td class="row-actions">${waiting.has(b.id) ? '' : `<button class="btn btn-sm" data-action="siteTier" data-id="${b.id}" data-name="${esc(b.name)}" data-tier="${b.tier}">Change tier…</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function sitePackages(){
  const s = state.site;
  const [packages, list] = await Promise.all([
    api(`/admin/partner-packages${s.pkgStatus ? `?status=${s.pkgStatus}` : ''}`),
    s.businesses.length ? null : api('/businesses?limit=100'),
  ]);
  s.packages = packages;
  if(list) s.businesses = list.items || [];
  const today = Date.now();
  return `
    <p class="hint">What each partner has bought for the website and the app. Prices are what you agreed; the ad itself is set up under Ads.</p>
    <div class="filters">
      <select aria-label="Filter packages by status" data-change="sitePkgStatus">
        <option value="">All packages</option>
        ${Object.entries(PACKAGE_STATUS).map(([k, v]) => `<option value="${k}" ${s.pkgStatus === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    ${!packages.length ? '<div class="empty">No packages yet.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Partner</th><th>Package</th><th>Runs</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody>${packages.map((p) => {
          const ending = p.status === 'ACTIVE' && new Date(p.endsAt).getTime() - today < 14 * 86_400_000;
          return `<tr>
            <td><strong>${esc(p.business.name)}</strong>${p.notes ? `<div class="hint">${esc(p.notes)}</div>` : ''}</td>
            <td>${esc(PACKAGE_KIND[p.kind] || p.kind)}</td>
            <td>${esc(dayBoth(p.startsAt))}<br>to ${esc(dayBoth(p.endsAt))}${ending ? '<div class="hint">Ends within two weeks: time to renew</div>' : ''}</td>
            <td>${esc(nprFromPaisa(p.pricePaisa))}</td>
            <td><span class="pill ${PACKAGE_TONE[p.status]}">${PACKAGE_STATUS[p.status]}</span></td>
            <td class="row-actions">
              <button class="btn btn-sm" data-action="siteEditPackage" data-id="${p.id}">Edit</button>
              <button class="btn btn-sm" data-action="sitePackageReport" data-id="${p.business.id}" data-name="${esc(p.business.name)}">Report</button>
            </td></tr>`;
        }).join('')}</tbody>
      </table></div>`}`;
}

function packageForm(p){
  const s = state.site;
  const isNew = !p.id;
  return `
    <div class="modal-back" data-action="backdrop" data-closer="siteCloseForm">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="pkg-title" data-submit="siteSavePackage" novalidate>
        <h2 id="pkg-title">${isNew ? 'New partner package' : `Package for ${esc(p.business?.name || '')}`}</h2>
        ${isNew ? `<label for="pkg-business">Partner</label>
          <select id="pkg-business" required>${s.businesses.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>` : ''}
        <label for="pkg-kind">Package</label>
        <select id="pkg-kind">${Object.entries(PACKAGE_KIND).map(([k, v]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <div class="site-two">
          <div><label for="pkg-start">Starts</label><input id="pkg-start" type="date" required value="${toDayInput(p.startsAt)}"></div>
          <div><label for="pkg-end">Ends</label><input id="pkg-end" type="date" required value="${toDayInput(p.endsAt)}"></div>
        </div>
        <div class="site-two">
          <div><label for="pkg-price">Price (NPR)</label><input id="pkg-price" type="number" min="0" step="0.01" inputmode="decimal" value="${p.pricePaisa != null ? p.pricePaisa / 100 : ''}"></div>
          <div><label for="pkg-status">Status</label>
            <select id="pkg-status">${Object.entries(PACKAGE_STATUS).map(([k, v]) => `<option value="${k}" ${(p.status || 'PROPOSED') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        </div>
        <label for="pkg-notes">Notes</label>
        <textarea id="pkg-notes" maxlength="2000" placeholder="What was agreed, who to call">${esc(p.notes || '')}</textarea>
        <div id="pkg-error" class="error" role="alert" hidden></div>
        <div class="row-actions site-gap">
          <button class="btn btn-primary" type="submit">${isNew ? 'Save package' : 'Save changes'}</button>
          <button class="btn btn-ghost" type="button" data-action="siteCloseForm">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function siteEnquiries(){
  const s = state.site;
  const q = new URLSearchParams({ page: String(s.enqPage), ...(s.enqStatus ? { status: s.enqStatus } : {}) });
  const r = s.enquiries = await api(`/admin/site/enquiries?${q}`);
  return `
    <div class="filters">
      <select aria-label="Filter enquiries" data-change="siteEnqStatus">
        <option value="NEW" ${s.enqStatus === 'NEW' ? 'selected' : ''}>Waiting for an answer</option>
        <option value="HANDLED" ${s.enqStatus === 'HANDLED' ? 'selected' : ''}>Handled</option>
        <option value="" ${!s.enqStatus ? 'selected' : ''}>All</option>
      </select>
    </div>
    ${!r.items.length ? `<div class="empty">${s.enqStatus === 'NEW' ? 'Nothing waiting. New messages are also emailed to the inbox set in ADMIN_INBOX.' : 'No enquiries here.'}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>From</th><th>Message</th><th>Received</th><th></th></tr></thead>
        <tbody>${r.items.map((e) => `<tr>
          <td><span class="pill ${e.kind === 'ADVERTISE' ? 'ACTIVE' : ''}">${ENQUIRY_KIND[e.kind]}</span><br>
            <strong>${esc(e.name)}</strong>${e.organisation ? `<br>${esc(e.organisation)}` : ''}<br><small>${esc(e.contact)}</small></td>
          <td class="site-msg">${esc(e.message)}</td>
          <td>${esc(dayBoth(e.createdAt))}${e.handledAt ? `<div class="hint">Handled ${esc(fmtDay(e.handledAt))}</div>` : ''}</td>
          <td class="row-actions">${e.status === 'NEW'
            ? `<button class="btn btn-sm btn-primary" data-action="siteEnqDone" data-id="${e.id}" data-status="HANDLED">Mark handled</button>`
            : `<button class="btn btn-sm" data-action="siteEnqDone" data-id="${e.id}" data-status="NEW">Reopen</button>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${r.pages > 1 ? `<div class="row-actions site-gap">
        ${s.enqPage > 1 ? '<button class="btn btn-sm" data-action="siteEnqPage" data-by="-1">← Newer</button>' : ''}
        <span class="hint">Page ${r.page} of ${r.pages}</span>
        ${s.enqPage < r.pages ? '<button class="btn btn-sm" data-action="siteEnqPage" data-by="1">Older →</button>' : ''}</div>` : ''}`}`;
}

async function siteNewsletter(){
  const n = state.site.newsletter = await api('/admin/site/newsletter');
  return `
    <div class="stat-grid">
      <div class="stat"><b>${n.confirmed}</b><span>Confirmed readers</span></div>
      <div class="stat"><b>${n.pending}</b><span>Waiting to confirm</span></div>
      <div class="stat"><b>${n.unsubscribed}</b><span>Unsubscribed</span></div>
    </div>
    <div class="card">
      <h3>Send an issue</h3>
      <p class="hint">Export the confirmed addresses for your email service. Each row has the reader's own unsubscribe link: put it in the email. The export is recorded in the audit log.</p>
      <button class="btn btn-primary" data-action="siteNewsletterCsv" ${n.confirmed ? '' : 'disabled'}>Download confirmed addresses (CSV)</button>
    </div>`;
}

Actions.on({
  siteTab: (el) => { state.site.tab = el.dataset.tab; state.site.editing = null; renderMain(); },
  siteNewPackage: () => {
    const now = Date.now();
    state.site.editing = { kind: 'LISTING', status: 'PROPOSED', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 30 * 86_400_000).toISOString() };
    renderMain();
  },
  siteEditPackage: (el) => { state.site.editing = state.site.packages.find((p) => p.id === el.dataset.id) || null; renderMain(); },
  siteCloseForm: () => { state.site.editing = null; renderMain(); },
  sitePackageReport: async (el) => {
    try{
      const month = new Date(Date.now() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 7);
      await downloadFile(`/businesses/${el.dataset.id}/report.pdf?month=${month}`);
    }catch(err){ notify(err.message, 'error'); }
  },
  siteEnqDone: async (el) => {
    try{
      await api(`/admin/site/enquiries/${el.dataset.id}`, { method: 'PATCH', body: { status: el.dataset.status } });
      notify(el.dataset.status === 'HANDLED' ? 'Marked handled' : 'Reopened');
    }catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteVerify: async (el) => {
    const note = await askDialog({
      title: `Verify ${el.dataset.name}`, confirmLabel: 'Verify',
      message: 'Say how you checked it. This note is kept with the listing and in the audit log.',
      field: { label: 'How it was checked', type: 'textarea', placeholder: 'Visited on 4 Oct; owner showed PAN certificate',
        validate: (v) => (v.length < 5 ? 'Write at least a few words.' : '') },
    });
    if(!note) return;
    try{ await api(`/businesses/${el.dataset.id}/verify`, { method: 'PATCH', body: { verificationNote: note } }); notify(`${el.dataset.name} is verified`); }
    catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteTier: async (el) => {
    const tier = await askDialog({
      title: `Tier for ${el.dataset.name}`, confirmLabel: 'Next',
      field: { label: 'Tier', type: 'select', value: el.dataset.tier, options: Object.entries(TIER_LABEL) },
    });
    if(!tier) return;
    let months = 1;
    if(tier !== 'FREE'){
      const m = await askDialog({
        title: `${TIER_LABEL[tier]} for how long?`, confirmLabel: 'Save',
        message: 'Counted on from the current end date if the partner is still paid up.',
        field: { label: 'Months', type: 'number', min: 1, max: 24, value: '1', validate: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 24 ? '' : 'Choose 1 to 24 months.') },
      });
      if(!m) return;
      months = Number(m);
    }
    try{ await api(`/businesses/${el.dataset.id}/tier`, { method: 'PATCH', body: { tier, months } }); notify('Tier saved'); }
    catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteEnqPage: (el) => { state.site.enqPage = Math.max(1, state.site.enqPage + Number(el.dataset.by)); renderMain(); },
  siteNewsletterCsv: async () => {
    try{ await downloadFile('/admin/site/newsletter.csv'); }catch(err){ notify(err.message, 'error'); }
  },
});

Actions.onChange({
  sitePkgStatus: (el) => { state.site.pkgStatus = el.value; renderMain(); },
  siteEnqStatus: (el) => { state.site.enqStatus = el.value; state.site.enqPage = 1; renderMain(); },
});

Actions.onSubmit({
  siteSavePackage: async (form, e) => {
    e.preventDefault();
    const p = state.site.editing;
    const val = (id) => form.querySelector(`#${id}`)?.value.trim() ?? '';
    const price = val('pkg-price');
    const body = {
      kind: val('pkg-kind'), status: val('pkg-status'),
      startsAt: nptDay(val('pkg-start')), endsAt: nptDay(val('pkg-end'), true),
      pricePaisa: price === '' ? null : Math.round(Number(price) * 100),
      notes: val('pkg-notes') || null,
    };
    const box = form.querySelector('#pkg-error');
    if(!body.startsAt || !body.endsAt){ box.textContent = 'Give the start and end dates.'; box.hidden = false; return; }
    try{
      if(p.id) await api(`/admin/partner-packages/${p.id}`, { method: 'PATCH', body });
      else await api('/admin/partner-packages', { method: 'POST', body: { ...body, businessId: val('pkg-business') } });
      state.site.editing = null;
      notify('Package saved');
      renderMain();
    }catch(err){ box.textContent = err.message; box.hidden = false; }
  },
});

CLOSERS.siteCloseForm = () => { state.site.editing = null; renderMain(); };
SECTIONS.splice(SECTIONS.findIndex(([k]) => k === 'ads') + 1, 0, ['website', 'Website', ['ADMIN']]);
SCREENS.website = screenWebsite;
