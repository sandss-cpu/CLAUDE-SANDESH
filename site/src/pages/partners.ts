import * as data from '../data';
import { CATEGORY_LABEL, dayBoth, intlNumber, SCHEMA_TYPE } from '../format';
import { html, raw } from '../html';
import { absolute, page, sponsoredLabel } from '../layout';
import {
  adSlot, crumbs, dealCard, field, formError, formGuards, FormState, img, isFeaturedTier, mediaUrl, partnerCard, partnerEvents, Rendered, sentNote,
} from '../parts';

export async function partners(filters: { place?: string; type?: string }): Promise<Rendered> {
  const places = await data.destinations();
  const place = places.find((p) => p.slug === filters.place);
  const type = filters.type && CATEGORY_LABEL[filters.type] ? filters.type : undefined;
  const list = await data.partners({ destinationId: place?.id, category: type });
  const query = new URLSearchParams({ ...(place ? { place: place.slug } : {}), ...(type ? { type } : {}) }).toString();
  const path = `/partners${query ? `?${query}` : ''}`;
  const title = [type ? CATEGORY_LABEL[type] : 'Partners', place ? `in ${place.name}` : ''].filter(Boolean).join(' ');

  const body = html`
<div class="wrap">
  ${crumbs(place || type ? [['/', 'Home'], ['/partners', 'Partners'], ['', title]] : [['/', 'Home'], ['', 'Partners']])}
  <header class="page-head">
    <h1>${place || type ? title : 'Partners & deals'}</h1>
    <p class="lede">Places to stay, eat and book, each checked by Batoma before it is listed. Featured partners pay for a higher place, and their card says so.</p>
    <p><a class="btn btn-ghost" href="/deals">See this month's deals</a></p>
  </header>
  <form class="filters" method="get" action="/partners">
    <div class="field">
      <label for="f-place">Place</label>
      <select id="f-place" name="place"><option value="">Anywhere</option>${places.map((p) => html`<option value="${p.slug}"${p.slug === place?.slug ? raw(' selected') : ''}>${p.name}</option>`)}</select>
    </div>
    <div class="field">
      <label for="f-type">Kind</label>
      <select id="f-type" name="type"><option value="">Any kind</option>${Object.entries(CATEGORY_LABEL).map(([k, v]) => html`<option value="${k}"${k === type ? raw(' selected') : ''}>${v}</option>`)}</select>
    </div>
    <button class="btn" type="submit">Show</button>
  </form>
  <h2 class="sr">Partners</h2>
  ${list.length ? html`<p class="dim">${list.length} ${list.length === 1 ? 'partner' : 'partners'}</p><div class="grid">${list.map(partnerCard)}</div>`
    : html`<p class="dim">No partners match yet. <a href="/partners">See them all</a>.</p>`}
  <aside class="note">Run a hotel, restaurant or agency on the road? <a href="/advertise">Become a Batoma partner</a>.</aside>
</div>`;
  return {
    html: page({ title: place || type ? title : 'Partners & deals', path, description: 'Hotels, homestays, restaurants and trekking agencies along Nepal\'s highways, each checked by Batoma.', noindex: !!query }, body),
    events: [{ type: 'PAGE_VIEW', path }, ...partnerEvents(list, path)],
  };
}

export async function partner(slug: string, form?: FormState & { sent?: boolean }): Promise<Rendered | null> {
  const p = await data.partner(slug);
  if (!p) return null;
  const path = `/partners/${p.slug}`;
  const phone = intlNumber(p.phone);
  const whatsapp = intlNumber(p.whatsapp);
  const viber = intlNumber(p.viber);
  const hasMap = p.latitude != null && p.longitude != null;
  const kind = CATEGORY_LABEL[p.category] ?? 'Partner';

  const body = html`
<article class="wrap partner">
  ${crumbs([['/', 'Home'], ['/partners', 'Partners'], ['', p.name]])}
  <header class="page-head">
    <p class="kicker">${kind}${p.destination ? html` · <a href="/places/${p.destination.slug}">${p.destination.name}</a>` : p.district ? ` · ${p.district}` : ''}</p>
    <h1>${p.name}</h1>
    <p class="byline badges"><span class="verified">Verified by Batoma</span>${isFeaturedTier(p.tier) ? raw('<span class="badge" title="Pays for a higher place">Featured partner</span>') : ''}${p.priceRange ? html`<span>${p.priceRange}</span>` : ''}</p>
  </header>
  ${p.photos.length ? html`<div class="photos">${p.photos.map((ph) => html`<figure>${img(ph.url, ph.caption ?? p.name, { sizes: '(min-width: 760px) 300px, 100vw', width: 640, height: 420 })}${ph.caption ? html`<figcaption>${ph.caption}</figcaption>` : ''}</figure>`)}</div>` : ''}
  <div class="two-col">
    <div>
      ${p.description ? html`<p class="lede">${p.description}</p>` : ''}
      ${p.amenities.length ? html`<h2>What they offer</h2><ul class="tags">${p.amenities.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
      ${p.coupons.length ? html`<h2>Deals</h2><div class="grid grid-2">${p.coupons.map((c) => dealCard({ ...c, business: { slug: p.slug, name: p.name, district: p.district } }))}</div>` : ''}
      <section id="enquire" aria-labelledby="h-enq">
        <h2 id="h-enq">Send ${p.name} a message</h2>
        ${form?.sent ? sentNote(`${p.name} has your message and will reply to the contact you gave.`) : html`
        <form method="post" action="/partners/${p.slug}/enquire#enquire" class="form">
          ${formError(form)}
          ${field('name', 'Your name', form, { required: true, max: 80, autocomplete: 'name' })}
          ${field('contact', 'Phone or email for the reply', form, { required: true, max: 120, autocomplete: 'email' })}
          ${field('message', 'Message', form, { required: true, max: 2000, textarea: true, hint: 'Dates, how many of you, and anything they should know.' })}
          ${formGuards()}
          <button class="btn" type="submit">Send message</button>
          <p class="small">We pass your name, contact and message to ${p.name} and keep a copy, so we can see partners answer. Nothing else. See our <a href="/privacy">privacy notice</a>.</p>
        </form>`}
      </section>
    </div>
    <aside class="contact-card" aria-label="Contact">
      <h2>Contact</h2>
      ${p.address ? html`<p>${p.address}${p.district ? `, ${p.district}` : ''}</p>` : p.district ? html`<p>${p.district}</p>` : ''}
      <div class="actions">
        ${phone ? html`<a class="btn" href="tel:+${phone}">Call</a>` : ''}
        ${whatsapp ? html`<a class="btn btn-ghost" href="/go/${p.slug}?to=whatsapp" rel="sponsored noopener">WhatsApp</a>` : ''}
        ${viber ? html`<a class="btn btn-ghost" href="viber://chat?number=%2B${viber}">Viber</a>` : ''}
        ${hasMap ? html`<a class="btn btn-ghost" href="/go/${p.slug}?to=map" rel="sponsored noopener">Directions</a>` : ''}
        ${p.website ? html`<a class="btn btn-ghost" href="/go/${p.slug}" rel="sponsored noopener">Website</a>` : ''}
        <a class="btn btn-ghost" href="#enquire">Message</a>
      </div>
    </aside>
  </div>
</article>`;

  const ld = {
    '@context': 'https://schema.org', '@type': SCHEMA_TYPE[p.category] ?? 'LocalBusiness',
    name: p.name, url: absolute(path),
    ...(p.description ? { description: p.description } : {}),
    ...(phone ? { telephone: `+${phone}` } : {}),
    ...(p.priceRange ? { priceRange: p.priceRange } : {}),
    ...(p.photos.length ? { image: p.photos.map((ph) => (mediaUrl(ph.url).startsWith('/') ? absolute(mediaUrl(ph.url)) : mediaUrl(ph.url))) } : {}),
    address: { '@type': 'PostalAddress', ...(p.address ? { streetAddress: p.address } : {}), ...(p.district ? { addressRegion: p.district } : {}), addressCountry: 'NP' },
    ...(hasMap ? { geo: { '@type': 'GeoCoordinates', latitude: p.latitude, longitude: p.longitude } } : {}),
    ...(p.amenities.length ? { amenityFeature: p.amenities.map((a) => ({ '@type': 'LocationFeatureSpecification', name: a, value: true })) } : {}),
  };
  return {
    html: page({ title: p.name, path, description: p.description?.slice(0, 160) ?? `${p.name}, ${kind.toLowerCase()} in ${p.district ?? 'Nepal'}, checked by Batoma.`, image: p.photos[0] ? mediaUrl(p.photos[0].url) : null, ld: [ld] }, body),
    events: [{ type: 'PAGE_VIEW', path, businessId: p.id }, { type: 'IMPRESSION', path, target: 'profile', businessId: p.id }],
    status: form && !form.sent && form.error ? 400 : 200,
  };
}

/** Each partner once, however many of their deals are on the page. */
export const dealPartners = (list: Array<{ business: { id: string } }>) => [...new Map(list.map((d) => [d.business.id, d.business])).values()];

export async function deals(): Promise<Rendered> {
  const path = '/deals';
  const [list, ads] = await Promise.all([data.deals(), data.liveAds('WEB_DEALS', { take: 2 })]);
  const slots = ads.map((a) => adSlot(a, path));
  const body = html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['/partners', 'Partners'], ['', 'Deals']])}
  <header class="page-head">
    <h1>Deals on the road</h1>
    <p class="lede">Offers from Batoma partners. Claim one in the Batoma app and show it when you pay; each has an end date.</p>
  </header>
  ${slots.map((s) => s.html)}
  <h2 class="sr">Current deals</h2>
  ${list.length ? html`<div class="grid">${list.map(dealCard)}</div>` : html`<p class="dim">No deals running just now.</p>`}
</div>`;
  return {
    html: page({ title: 'Deals', path, description: 'Discounts and offers from hotels, restaurants and agencies along Nepal\'s highways, from Batoma partners.' }, body),
    events: [{ type: 'PAGE_VIEW', path }, ...slots.flatMap((s) => s.events), ...partnerEvents(dealPartners(list), path, 'deal')],
  };
}

/** An ad that opens a page of its own rather than an outside link. Labelled, and kept out of search. */
export async function offer(id: string): Promise<Rendered | null> {
  const ad = await data.offer(id);
  if (!ad) return null;
  const path = `/offers/${ad.id}`;
  const body = html`
<article class="wrap-narrow">
  <p>${sponsoredLabel(ad.advertiserName)}</p>
  <h1>${ad.overviewTitle ?? ad.title}</h1>
  ${ad.tagline ? html`<p class="lede">${ad.tagline}</p>` : ''}
  ${ad.overviewImageUrl || ad.imageUrl ? html`<figure class="cover">${img(ad.overviewImageUrl ?? ad.imageUrl, '', { sizes: '(min-width: 760px) 720px, 100vw', width: 1200, height: 600, lazy: false })}</figure>` : ''}
  ${ad.overviewBody ? html`<div class="story-body">${ad.overviewBody.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}</div>` : ''}
  ${ad.business ? html`<p><a class="btn" href="/partners/${ad.business.slug}">About ${ad.business.name}</a></p>` : ''}
  ${ad.linkType === 'EXTERNAL' && ad.externalUrl ? html`<p><a class="btn btn-ghost" href="/go/ad/${ad.id}" rel="sponsored noopener">Visit ${ad.advertiserName}</a></p>` : ''}
  <p class="small">This is a paid placement. Batoma labels everything a partner pays for.</p>
</article>`;
  return {
    html: page({ title: ad.overviewTitle ?? ad.title, path, description: ad.tagline ?? `An offer from ${ad.advertiserName}.`, noindex: true }, body),
    events: [{ type: 'PAGE_VIEW', path, adId: ad.id }],
  };
}
