/* ===========================================================================
   The public website, from the control panel: what it shows and how much it is read,
   which published articles it carries (kept on or taken off, separately from the app),
   its ad slots, partner listings, partner packages (what each partner has bought, for
   how long and at what price), the enquiry inbox (contact and advertising messages
   from the website) and the newsletter list. Every change reaches the website at once:
   the API drops its page cache.

   A classic script loaded after admin.js, sharing its globals (state, api, esc,
   notify, askDialog, renderMain, downloadFile, SECTIONS, SCREENS, Actions). Prices
   are entered in rupees and kept in paisa. Every change is audited by the API.
   =========================================================================== */

state.site = {
  tab: 'overview', packages: [], pkgStatus: '', businesses: [], editing: null, pending: null, listing: null,
  lsList: null, lsQ: '', lsShow: '', lsPage: 1,
  enquiries: null, enqStatus: 'NEW', enqPage: 1, newsletter: null,
  overview: null, articles: null, artQ: '', artShow: '', artPage: 1, adStatus: '',
};

const SITE_BASE = (window.BATO_CONFIG?.site || 'http://localhost:4000').replace(/\/$/, '');
const newTab = (href, label, cls = 'btn btn-sm') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label} ↗</a>`;

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
  const tabs = [
    ['overview', 'Overview'], ['articles', 'Articles'], ['ads', 'Ads'], ['listings', 'Listings'],
    ['packages', 'Partner packages'], ['enquiries', 'Enquiries'], ['newsletter', 'Newsletter'],
  ];
  const screens = {
    overview: siteOverview, articles: siteArticles, ads: siteAds, listings: siteListings,
    packages: sitePackages, enquiries: siteEnquiries, newsletter: siteNewsletter,
  };
  const body = await (screens[s.tab] || siteOverview)();
  return `
    <div class="top-row"><h2>Website</h2>
      <div class="row-actions">
        ${s.tab === 'packages' ? '<button class="btn btn-primary" data-action="siteNewPackage">+ New package</button>' : ''}
        ${s.tab === 'ads' ? '<button class="btn btn-primary" data-action="siteNewAd">+ New website ad</button>' : ''}
        ${newTab(SITE_BASE, 'Open the website', 'btn')}
      </div></div>
    <div class="filters" role="tablist" aria-label="Website">
      ${tabs.map(([k, label]) => `<button class="btn btn-sm ${s.tab === k ? 'btn-primary' : ''}" role="tab" aria-selected="${s.tab === k}" data-action="siteTab" data-tab="${k}">${label}</button>`).join('')}
    </div>
    ${body}
    ${s.editing ? packageForm(s.editing) : ''}
    ${s.tab === 'ads' && state.ads.editing ? adForm(state.ads.editing, { webOnly: true }) : ''}
    ${s.tab === 'ads' && state.ads.confirmDelete ? confirmDeleteAdDialog(state.ads.items.find((x) => x.id === state.ads.confirmDelete)) : ''}`;
}

/** What the website shows right now, each figure a way into the tab that changes it. */
async function siteOverview(){
  const o = state.site.overview = await api('/admin/site/overview');
  const stat = (n, label, tab, sub = '') => `<button class="stat stat-link" data-action="siteTab" data-tab="${tab}">
    <b>${n.toLocaleString('en-IN')}</b><span>${label}</span>${sub ? `<div class="hint">${sub}</div>` : ''}</button>`;
  return `
    <p class="hint">Everything on the public website comes from this control panel. A change here reaches it within seconds.</p>
    <div class="stat-grid">
      ${stat(o.articles.onSite, 'Stories on the website', 'articles', o.articles.offSite ? `${o.articles.offSite} taken off` : '')}
      ${stat(o.ads.live, 'Ads showing now', 'ads', [o.ads.scheduled && `${o.ads.scheduled} scheduled`, o.ads.paused && `${o.ads.paused} paused`].filter(Boolean).join(' · '))}
      ${stat(o.partners, 'Partners listed', 'listings')}
      ${stat(o.deals, 'Live deals', 'listings')}
      ${stat(o.views30, 'Page views, last 30 days', 'articles')}
      ${stat(o.enquiries, 'Enquiries waiting', 'enquiries')}
    </div>
    <div class="site-two site-cards">
      <div class="card">
        <h3>Most read in the last 30 days</h3>
        ${!o.mostRead.length ? '<div class="empty">No story has been read on the website yet.</div>' : `
          <ol class="site-list">${o.mostRead.map((a, i) => `<li>
            <span>${i + 1}. ${esc(a.title)}${a.onWebsite && a.status === 'PUBLISHED' ? '' : ' <span class="pill REJECTED">Not on the website now</span>'}</span>
            <span class="row-actions"><small>${a.views.toLocaleString('en-IN')} views</small>${a.onWebsite && a.status === 'PUBLISHED' ? newTab(a.url, 'View') : ''}</span>
          </li>`).join('')}</ol>`}
      </div>
      <div class="card">
        <h3>Where each part is managed</h3>
        <table class="site-where"><tbody>
          <tr><td>Stories</td><td>Write and publish under <button class="btn btn-sm btn-ghost" data-action="goSection" data-key="articles">Articles</button>; keep on or take off the website under <button class="btn btn-sm btn-ghost" data-action="siteTab" data-tab="articles">Website → Articles</button></td></tr>
          <tr><td>Ads and sponsors</td><td><button class="btn btn-sm btn-ghost" data-action="siteTab" data-tab="ads">Website → Ads</button> (app ads stay under Ads)</td></tr>
          <tr><td>Trip guides</td><td><button class="btn btn-sm btn-ghost" data-action="goSection" data-key="guides">Route guides</button>: ${o.guides} published</td></tr>
          <tr><td>Partners and deals</td><td><button class="btn btn-sm btn-ghost" data-action="siteTab" data-tab="listings">Website → Listings</button> and <button class="btn btn-sm btn-ghost" data-action="siteTab" data-tab="packages">Partner packages</button></td></tr>
          <tr><td>Drafts</td><td>${o.articles.unpublished} not yet published: never on the website until they are</td></tr>
        </tbody></table>
      </div>
    </div>`;
}

/** Published articles only: drafts never reach the website. Taking one off leaves it in the app. */
async function siteArticles(){
  const s = state.site;
  const q = new URLSearchParams({ page: String(s.artPage), ...(s.artQ ? { q: s.artQ } : {}), ...(s.artShow ? { show: s.artShow } : {}) });
  const r = s.articles = await api(`/admin/site/articles?${q}`);
  return `
    <p class="hint">Every published article appears on the website unless you take it off here. Taking a story off the website leaves it in the app on the buses; to remove it everywhere, archive it under Articles. Featured stories lead the website's home page.</p>
    <div class="filters">
      <input type="search" aria-label="Search articles" placeholder="Search title or subtitle…" value="${esc(s.artQ)}" data-change="siteArtSearch">
      <select aria-label="Show articles" data-change="siteArtShow">
        <option value="" ${!s.artShow ? 'selected' : ''}>All published articles</option>
        <option value="on" ${s.artShow === 'on' ? 'selected' : ''}>On the website</option>
        <option value="off" ${s.artShow === 'off' ? 'selected' : ''}>Taken off the website</option>
      </select>
    </div>
    ${!r.items.length ? `<div class="empty">${s.artQ || s.artShow ? 'No articles match.' : 'Nothing published yet. Publish an article under Articles and it appears here.'}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Article</th><th>On the website</th><th>Views (30 days)</th><th></th></tr></thead>
        <tbody>${r.items.map((a) => `<tr>
          <td><div class="ad-cell">${a.coverImageUrl ? `<img src="${esc(a.coverImageUrl)}" alt="">` : ''}
            <div><strong>${esc(a.title)}</strong><br>
            <small>${esc(a.category?.name || 'No section')}${a.publishedAt ? ` · published ${esc(fmtDay(a.publishedAt))}` : ''}</small>
            ${a.isFeatured ? ' <span class="pill lead-pill">Featured</span>' : ''}${a.isSponsored ? ' <span class="pill">Sponsored</span>' : ''}</div></div></td>
          <td>${a.onWebsite ? '<span class="pill ACTIVE">On the website</span>' : '<span class="pill REJECTED">Taken off</span><div class="hint">Still in the app</div>'}</td>
          <td>${a.views30.toLocaleString('en-IN')}</td>
          <td class="row-actions">
            ${a.onWebsite
              ? `<button class="btn btn-sm btn-danger" data-action="siteArtWebsite" data-id="${a.id}" data-on="false">Take off website</button>`
              : `<button class="btn btn-sm btn-primary" data-action="siteArtWebsite" data-id="${a.id}" data-on="true">Put back on website</button>`}
            <button class="btn btn-sm" data-action="siteArtFeature" data-id="${a.id}" data-on="${!a.isFeatured}">${a.isFeatured ? 'Unfeature' : 'Feature'}</button>
            <button class="btn btn-sm" data-action="siteArtEdit" data-id="${a.id}">Edit</button>
            ${a.onWebsite ? newTab(a.url, 'View') : ''}
          </td></tr>`).join('')}</tbody>
      </table></div>
      ${r.pages > 1 ? `<div class="row-actions site-gap">
        ${s.artPage > 1 ? '<button class="btn btn-sm" data-action="siteArtPage" data-by="-1">← Newer</button>' : ''}
        <span class="hint">Page ${r.page} of ${r.pages} · ${r.total} articles</span>
        ${s.artPage < r.pages ? '<button class="btn btn-sm" data-action="siteArtPage" data-by="1">Older →</button>' : ''}</div>` : ''}`}`;
}

/** Where each website slot can be seen, so a live ad can be checked in place. */
function webAdPath(ad){
  const cat = state.categories.find((c) => c.id === ad.targetCategoryId);
  const place = state.destinations.find((d) => d.id === ad.targetDestinationId);
  return ({
    WEB_HOME_HERO: '/', WEB_SPONSORED_ARTICLE: '/', WEB_NEWSLETTER: '/', WEB_DEALS: '/deals',
    WEB_SECTION_SPONSOR: cat?.slug ? `/magazine/section/${cat.slug}` : '/magazine',
    WEB_DESTINATION_SPONSOR: place?.slug ? `/places/${place.slug}` : '/trips#places',
  })[ad.placement] || '/';
}

/** The website's ad slots only; the form is the one under Ads, limited to website placements. */
async function siteAds(){
  const s = state.site;
  await loadReferenceData();
  const q = new URLSearchParams({ surface: 'web', ...(s.adStatus ? { status: s.adStatus } : {}) });
  const items = state.ads.items = await api(`/ads/admin?${q}`);
  return `
    <p class="hint">Ads and sponsor slots on the public website. Pause one to take it down for now and keep its counts; remove it to delete it. The app's ads are under Ads.</p>
    <div class="filters">
      <select aria-label="Filter website ads by status" data-change="siteAdStatus">
        ${['', 'ACTIVE', 'SCHEDULED', 'PAUSED', 'EXPIRED'].map((st) =>
          `<option value="${st}" ${s.adStatus === st ? 'selected' : ''}>${st ? AD_STATUS_LABEL[st] : 'All website ads'}</option>`).join('')}
      </select>
    </div>
    ${state.ads.flash ? `<div class="error" role="alert">${esc(state.ads.flash)}</div>` : ''}
    ${!items.length ? `<div class="empty">${s.adStatus ? 'No website ads here.' : 'No website ads yet. Each slot shows nothing until an ad fills it.'}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Ad</th><th>Where on the website</th><th>Status</th><th>Runs</th><th>Views</th><th>Clicks</th><th></th></tr></thead>
        <tbody>${items.map((ad) => `<tr>
          <td><div class="ad-cell"><img src="${esc(ad.imageUrl)}" alt="">
            <div><strong>${esc(ad.title)}</strong><br>
            <small>${esc(ad.advertiserName)} · ${ad.linkType === 'EXTERNAL' ? 'Opens website' : 'Overview page'}</small></div></div></td>
          <td>${esc((PLACEMENTS[ad.placement] || ad.placement).replace(/^Website: /, ''))}</td>
          <td><span class="pill ${ad.status}">${AD_STATUS_LABEL[ad.status]}</span></td>
          <td>${fmtDay(ad.startsAt)} – ${fmtDay(ad.endsAt)}<br><small>${adTiming(ad)}</small></td>
          <td>${(ad.site?.views ?? 0).toLocaleString('en-IN')}</td>
          <td>${(ad.site?.clicks ?? 0).toLocaleString('en-IN')}</td>
          <td class="row-actions">
            <button class="btn btn-sm" data-action="openAdForm" data-id="${ad.id}">Edit</button>
            ${ad.status !== 'EXPIRED'
              ? `<button class="btn btn-sm" data-action="toggleAd" data-id="${ad.id}" data-active="${!ad.isActive}">${ad.isActive ? 'Pause' : 'Resume'}</button>` : ''}
            <button class="btn btn-sm btn-danger" data-action="askDeleteAd" data-id="${ad.id}">Remove</button>
            ${ad.status === 'ACTIVE' ? newTab(`${SITE_BASE}${webAdPath(ad)}`, 'See it') : ''}
          </td></tr>`).join('')}</tbody>
      </table></div>`}`;
}

/** Verification is manual: nothing unverified reaches the website. Then the tier a partner pays for. */
async function siteListings(){
  const s = state.site;
  const q = new URLSearchParams({ page: String(s.lsPage), limit: '50', ...(s.lsQ ? { q: s.lsQ } : {}), ...(s.lsShow ? { show: s.lsShow } : {}) });
  const [pending, list] = await Promise.all([api('/businesses/admin/pending-verification?limit=50'), api(`/businesses/admin?${q}`), loadReferenceData()]);
  s.pending = pending.items || [];
  const r = s.lsList = list;
  return `
    <div class="row-actions" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <p class="hint" style="margin:0;flex:1 1 320px">Add a hotel, homestay, restaurant, agency or any business on the road. Verified listings appear on the website and in the app at once.</p>
      <button class="btn btn-primary" data-action="siteNewListing">+ Add listing</button>
    </div>
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
          <td class="row-actions"><button class="btn btn-sm" data-action="siteEditListing" data-id="${b.id}">Edit</button>
            <button class="btn btn-sm" data-action="siteDocs" data-id="${b.id}" data-name="${esc(b.name)}">Documents</button>
            <button class="btn btn-sm btn-primary" data-action="siteVerify" data-id="${b.id}" data-name="${esc(b.name)}">Verify…</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    <h3 class="site-gap">All listings</h3>
    <p class="hint">Hide a listing to take it off the website, the app and the road guides; its enquiries, reviews, deals and payments are kept, and you can show it again. Remove for good is only for a listing that has none of those, such as one added by mistake.</p>
    <div class="filters">
      <input type="search" aria-label="Search listings" placeholder="Search name or district…" value="${esc(s.lsQ)}" data-change="siteLsSearch">
      <select aria-label="Show listings" data-change="siteLsShow">
        <option value="" ${!s.lsShow ? 'selected' : ''}>All listings</option>
        <option value="on" ${s.lsShow === 'on' ? 'selected' : ''}>Shown</option>
        <option value="off" ${s.lsShow === 'off' ? 'selected' : ''}>Hidden</option>
      </select>
    </div>
    ${!r.items.length ? `<div class="empty">${s.lsQ || s.lsShow ? 'No listings match.' : 'No listings yet. Add the first with “+ Add listing”.'}</div>` : `
      <div class="table-wrap"><table class="ls-table">
        <thead><tr><th>Business</th><th>Status</th><th></th></tr></thead>
        <tbody>${r.items.map((b) => `<tr${b.isActive ? '' : ' class="ls-hidden"'}>
          <td><strong>${esc(b.name)}</strong><br><small>${esc(BIZ_CATEGORY[b.category] || b.category)}${b.district ? ` · ${esc(b.district)}` : ''}${b.owner?.email ? ` · owner ${esc(b.owner.email)}` : ''}</small>
            ${b.history ? `<div class="hint">It ${esc(b.history)}.</div>` : ''}</td>
          <td>${!b.isActive ? '<span class="pill REJECTED">Hidden</span>'
            : !b.verifiedAt ? '<span class="pill PENDING">Not verified</span>'
            : `<span class="pill ${b.tier === 'FREE' ? '' : 'ACTIVE'}">${TIER_LABEL[b.tier] || b.tier}</span>`}</td>
          <td class="ls-actions"><div class="row-actions"><button class="btn btn-sm" data-action="siteEditListing" data-id="${b.id}">Edit</button>
            ${b.isActive && b.verifiedAt ? `<button class="btn btn-sm" data-action="siteTier" data-id="${b.id}" data-name="${esc(b.name)}" data-tier="${b.tier}">Change tier…</button>
              ${newTab(`${SITE_BASE}/partners/${encodeURIComponent(b.slug)}`, 'View')}` : ''}
            ${b.isActive
              ? `<button class="btn btn-sm" data-action="siteHideListing" data-id="${b.id}" data-name="${esc(b.name)}">Hide…</button>`
              : `<button class="btn btn-sm btn-primary" data-action="siteShowListing" data-id="${b.id}" data-name="${esc(b.name)}">Show again</button>`}
            ${b.removable ? `<button class="btn btn-sm btn-danger" data-action="siteRemoveListing" data-id="${b.id}" data-name="${esc(b.name)}">Remove…</button>` : ''}</div></td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${r.meta.pages > 1 ? `<div class="row-actions site-gap">
        ${s.lsPage > 1 ? '<button class="btn btn-sm" data-action="siteLsPage" data-by="-1">← Previous</button>' : ''}
        <span class="hint">Page ${r.meta.page} of ${r.meta.pages} · ${r.meta.total} listings</span>
        ${s.lsPage < r.meta.pages ? '<button class="btn btn-sm" data-action="siteLsPage" data-by="1">Next →</button>' : ''}</div>` : ''}`}
    ${s.listing ? listingForm(s.listing) : ''}`;
}

/* ---- adding and editing a listing ---- */

const MAX_LISTING_PHOTOS = 12;

function listingPhotos(urls){
  return urls.length
    ? urls.map((u, i) => `<figure class="ls-photo"><img src="${esc(u)}" alt="Photo ${i + 1}">
        <button type="button" class="btn btn-sm btn-ghost" data-action="siteListingPhotoRemove" data-index="${i}" aria-label="Remove photo ${i + 1}">Remove</button></figure>`).join('')
    : '<p class="hint">No photos yet. The first is the cover.</p>';
}

/** One form for a new listing and an existing one: Website → Listings. */
function listingForm(b){
  const isNew = !b.id;
  const v = (k) => esc(b[k] ?? '');
  const places = state.destinations || [];
  return `
    <div class="modal-back" data-action="backdrop" data-closer="siteCloseListing">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="ls-title" data-submit="siteSaveListing" novalidate style="max-width:760px">
        <h2 id="ls-title">${isNew ? 'Add a listing' : `Edit · ${esc(b.name)}`}</h2>
        ${isNew ? '<p class="hint">A business travellers can call, visit or book: it gets a page on the website and a place in the app and on the road guides.</p>' : ''}
        <div class="site-two">
          <div><label for="ls-name">Name</label><input id="ls-name" required maxlength="160" value="${v('name')}" placeholder="Hilltop Homestay"></div>
          <div><label for="ls-category">Kind</label>
            <select id="ls-category">${Object.entries(BIZ_CATEGORY).map(([k, l]) => `<option value="${k}" ${b.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        </div>
        <label for="ls-desc">About it <small>(optional)</small></label>
        <textarea id="ls-desc" class="short" rows="4" maxlength="2000" placeholder="What it is, what makes it worth the stop">${v('description')}</textarea>
        <div class="site-two">
          <div><label for="ls-place">Place on the website <small>(optional)</small></label>
            <select id="ls-place"><option value="">None</option>${places.map((pl) => `<option value="${esc(pl.id)}" ${b.destinationId === pl.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select></div>
          <div><label for="ls-district">District <small>(optional)</small></label><input id="ls-district" maxlength="80" value="${v('district')}" placeholder="Tanahun"></div>
        </div>
        <label for="ls-address">Address <small>(optional)</small></label>
        <input id="ls-address" maxlength="200" value="${v('address')}" placeholder="Bazaar street, Bandipur">
        <div class="site-two">
          <div><label for="ls-lat">Map pin: latitude <small>(optional)</small></label><input id="ls-lat" inputmode="decimal" value="${v('latitude')}" placeholder="27.9431"></div>
          <div><label for="ls-lng">Longitude</label><input id="ls-lng" inputmode="decimal" value="${v('longitude')}" placeholder="84.4164"></div>
        </div>
        <div class="site-two">
          <div><label for="ls-phone">Phone <small>(optional)</small></label><input id="ls-phone" type="tel" maxlength="20" value="${v('phone')}" placeholder="9841234567"></div>
          <div><label for="ls-whatsapp">WhatsApp <small>(optional)</small></label><input id="ls-whatsapp" type="tel" maxlength="20" value="${v('whatsapp')}"></div>
        </div>
        <div class="site-two">
          <div><label for="ls-viber">Viber <small>(optional)</small></label><input id="ls-viber" type="tel" maxlength="20" value="${v('viber')}"></div>
          <div><label for="ls-website">Website <small>(optional)</small></label><input id="ls-website" type="url" maxlength="300" value="${v('website')}" placeholder="https://"></div>
        </div>
        <div class="site-two">
          <div><label for="ls-price">Price range <small>(optional)</small></label><input id="ls-price" maxlength="60" value="${v('priceRange')}" placeholder="NPR 1,500–4,000"></div>
          <div><label for="ls-amenities">Amenities <small>(comma between)</small></label><input id="ls-amenities" maxlength="400" value="${esc((b.amenities || []).join(', '))}" placeholder="Wi-Fi, hot water, parking"></div>
        </div>
        <label>Photos <small>(up to ${MAX_LISTING_PHOTOS}; the first is the cover)</small></label>
        <div id="ls-photos" class="ls-photos">${listingPhotos(b.photoUrls || [])}</div>
        <div class="row-actions"><input type="file" accept="image/*" multiple data-change="siteListingPhotoAdd" aria-label="Add photos"><span id="ls-photo-status" class="hint"></span></div>
        <label for="ls-owner">Owner's Batoma account <small>(optional)</small></label>
        <input id="ls-owner" type="email" maxlength="254" value="${esc(b.ownerEmail || '')}" placeholder="owner@example.com" autocomplete="off">
        <p class="hint">The email the business owner signed up to Batoma with. Linked, they manage this listing in the partner area: enquiries, deals, reviews and their monthly report. Empty: Batoma manages it.</p>
        ${isNew ? `
          <label class="check"><input type="checkbox" id="ls-verify" ${b.verify === false ? '' : 'checked'}> Batoma has checked this business (it goes on the website at once)</label>
          <label for="ls-note">How it was checked</label>
          <textarea id="ls-note" class="short" rows="2" maxlength="500" placeholder="Visited on 8 October; met the owner, saw the PAN certificate">${esc(b.verificationNote || '')}</textarea>
          <p class="hint">Unticked, it waits under “Waiting for verification” and is not shown anywhere until verified.</p>` : ''}
        <div id="ls-error" class="error" role="alert" hidden></div>
        <div class="row-actions site-gap">
          <button class="btn btn-primary" type="submit">${isNew ? 'Add listing' : 'Save changes'}</button>
          <button class="btn btn-ghost" type="button" data-action="siteCloseListing">Cancel</button>
        </div>
      </form>
    </div>`;
}

function siteCloseListing(){ state.site.listing = null; renderMain(); }
CLOSERS.siteCloseListing = siteCloseListing;

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

/** One change to one article's place on the website; the list is drawn again from the API. */
async function setArticleOnSite(id, body, done){
  try{ await api(`/admin/site/articles/${id}`, { method: 'PATCH', body }); notify(done); }
  catch(err){ notify(err.message, 'error'); }
  renderMain();
}

Actions.on({
  siteTab: (el) => {
    state.site.tab = el.dataset.tab; state.site.editing = null;
    state.ads.editing = null; state.ads.confirmDelete = null; state.ads.flash = '';
    renderMain();
  },
  siteArtWebsite: (el) => setArticleOnSite(el.dataset.id, { onWebsite: el.dataset.on === 'true' },
    el.dataset.on === 'true' ? 'Back on the website' : 'Taken off the website. It is still in the app.'),
  siteArtFeature: (el) => setArticleOnSite(el.dataset.id, { isFeatured: el.dataset.on === 'true' },
    el.dataset.on === 'true' ? 'Featured' : 'No longer featured'),
  siteArtEdit: async (el) => {
    state.screen = 'articles';
    renderSidebar();
    try{ await loadReferenceData(); await editArticle(el.dataset.id); }
    catch(err){ notify(err.message, 'error'); renderMain(); }
  },
  siteArtPage: (el) => { state.site.artPage = Math.max(1, state.site.artPage + Number(el.dataset.by)); renderMain(); },
  siteNewAd: () => { state.ads.editing = { placement: 'WEB_HOME_HERO' }; state.ads.flash = ''; renderMain(); },
  siteNewPackage: () => {
    const now = Date.now();
    state.site.editing = { kind: 'LISTING', status: 'PROPOSED', startsAt: new Date(now).toISOString(), endsAt: new Date(now + 30 * 86_400_000).toISOString() };
    renderMain();
  },
  siteEditPackage: (el) => { state.site.editing = state.site.packages.find((p) => p.id === el.dataset.id) || null; renderMain(); },
  siteCloseForm: () => { state.site.editing = null; renderMain(); },
  siteNewListing: () => { state.site.listing = { category: 'HOMESTAY', photoUrls: [], amenities: [], verify: true }; renderMain(); },
  siteEditListing: async (el) => {
    try{
      const b = await api(`/businesses/admin/${el.dataset.id}`);
      state.site.listing = { ...b, photoUrls: (b.photos || []).map((p) => p.url), ownerEmail: b.owner?.email || '' };
      renderMain();
    }catch(err){ notify(err.message, 'error'); }
  },
  siteCloseListing: () => siteCloseListing(),
  siteLsPage: (el) => { state.site.lsPage = Math.max(1, state.site.lsPage + Number(el.dataset.by)); renderMain(); },
  siteHideListing: async (el) => {
    const reason = await askDialog({
      title: `Hide ${el.dataset.name}`, confirmLabel: 'Hide it', danger: true,
      message: 'It goes off the website, the app and the road guides at once, and its deals can no longer be claimed. Enquiries, reviews, deals and payments are kept, and its owner still sees it in the partner area. You can show it again at any time.',
      field: { label: 'Why it is hidden (kept in the audit log)', type: 'textarea', placeholder: 'Closed for the monsoon; complaints about overcharging; the owner asked',
        validate: (v) => (v.length < 5 ? 'Write at least a few words.' : '') },
    });
    if(!reason) return;
    try{ await api(`/businesses/admin/${el.dataset.id}/visibility`, { method: 'PATCH', body: { shown: false, reason } }); notify(`${el.dataset.name} is hidden`); }
    catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteShowListing: async (el) => {
    try{ await api(`/businesses/admin/${el.dataset.id}/visibility`, { method: 'PATCH', body: { shown: true } }); notify(`${el.dataset.name} is shown again`); }
    catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteRemoveListing: async (el) => {
    const ok = await askDialog({
      title: `Remove ${el.dataset.name} for good?`, confirmLabel: 'Remove for good', danger: true,
      message: 'The listing and its photos are deleted and cannot be brought back. It has no enquiries, reviews, deals or payments. To take it down for now, hide it instead.',
    });
    if(!ok) return;
    try{ await api(`/businesses/admin/${el.dataset.id}`, { method: 'DELETE' }); notify(`${el.dataset.name} is removed`); }
    catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
  siteListingPhotoRemove: (el) => {
    const l = state.site.listing;
    l.photoUrls.splice(Number(el.dataset.index), 1);
    $('#ls-photos').innerHTML = listingPhotos(l.photoUrls);
  },
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
  siteDocs: (el) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="docs-title">
      <div class="top-row"><h2 id="docs-title">${esc(el.dataset.name)}: documents</h2><button class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <div id="biz-docs"><div class="hint">Loading…</div></div></div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-close]')) close(); });
    back.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });
    document.body.appendChild(back);
    back.querySelector('[data-close]').focus();
    fillDocuments(back.querySelector('#biz-docs'), { businessId: el.dataset.id });
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
  siteArtSearch: (el) => { state.site.artQ = el.value.trim(); state.site.artPage = 1; renderMain(); },
  siteArtShow: (el) => { state.site.artShow = el.value; state.site.artPage = 1; renderMain(); },
  siteAdStatus: (el) => { state.site.adStatus = el.value; renderMain(); },
  sitePkgStatus: (el) => { state.site.pkgStatus = el.value; renderMain(); },
  siteEnqStatus: (el) => { state.site.enqStatus = el.value; state.site.enqPage = 1; renderMain(); },
  siteLsSearch: (el) => { state.site.lsQ = el.value.trim(); state.site.lsPage = 1; renderMain(); },
  siteLsShow: (el) => { state.site.lsShow = el.value; state.site.lsPage = 1; renderMain(); },
});

Actions.onChange({
  // Only the photo strip redraws, so whatever has been typed stays.
  siteListingPhotoAdd: async (el) => {
    const l = state.site.listing;
    const files = [...el.files].slice(0, MAX_LISTING_PHOTOS - l.photoUrls.length);
    el.value = '';
    const status = $('#ls-photo-status');
    if(!files.length){ status.textContent = `Twelve photos at most.`; return; }
    status.textContent = 'Uploading…';
    try{
      const { files: saved, rejectedCount } = await uploadImages(files);
      l.photoUrls.push(...saved.map((f) => f.url));
      $('#ls-photos').innerHTML = listingPhotos(l.photoUrls);
      status.textContent = rejectedCount ? `${rejectedCount} file(s) were not real images and were left out.` : 'Uploaded. Save to keep them.';
    }catch(err){ status.textContent = err.message; }
  },
});

Actions.onSubmit({
  siteSaveListing: async (form, e) => {
    e.preventDefault();
    const l = state.site.listing;
    const val = (id) => form.querySelector(`#${id}`)?.value.trim() ?? '';
    const box = form.querySelector('#ls-error');
    const fail = (m) => { box.textContent = m; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); };
    const body = {
      name: val('ls-name'), category: val('ls-category'), description: val('ls-desc'),
      destinationId: val('ls-place') || null, district: val('ls-district'), address: val('ls-address'),
      latitude: val('ls-lat'), longitude: val('ls-lng'),
      phone: val('ls-phone'), whatsapp: val('ls-whatsapp'), viber: val('ls-viber'), website: val('ls-website'),
      priceRange: val('ls-price'), amenities: val('ls-amenities').split(',').map((a) => a.trim()).filter(Boolean),
      photoUrls: l.photoUrls, ownerEmail: val('ls-owner'),
    };
    if(!body.name) return fail('Give the business a name.');
    if(!l.id){
      body.verify = !!form.querySelector('#ls-verify')?.checked;
      if(body.verify) body.verificationNote = val('ls-note');
      if(body.verify && body.verificationNote.length < 5) return fail('Say how Batoma checked it, or untick “Batoma has checked this business”.');
    }
    try{
      const saved = await api(l.id ? `/businesses/admin/${l.id}` : '/businesses/admin', { method: l.id ? 'PATCH' : 'POST', body });
      state.site.listing = null;
      notify(l.id ? `${saved.name} saved.` : saved.verifiedAt ? `${saved.name} added: it is on the website now.` : `${saved.name} added; it waits for verification.`);
      renderMain();
    }catch(err){ fail(err.message); }
  },
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
