import * as data from '../data';
import { isoDate } from '../format';
import { html, raw } from '../html';
import { absolute, page } from '../layout';
import { adSlot, articleCard, articleEvents, crumbs, guideCard, mediaUrl, partnerCard, partnerEvents, Rendered, stopRow } from '../parts';

export async function trips(): Promise<Rendered> {
  const path = '/trips';
  const [roads, ideas, places] = await Promise.all([data.guides({ kind: 'ROUTE' }), data.guides({ kind: 'DESTINATION' }), data.destinations()]);
  const body = html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['', 'Trips']])}
  <header class="page-head">
    <h1>Trips</h1>
    <p class="lede">Road guides for the highways the buses take, stop by stop, and ideas for a few days at the other end.</p>
  </header>
  <section aria-labelledby="h-roads">
    <h2 id="h-roads">Road guides</h2>
    ${roads.length ? html`<div class="grid">${roads.map(guideCard)}</div>` : html`<p class="dim">Road guides are on their way.</p>`}
  </section>
  <section aria-labelledby="h-ideas">
    <h2 id="h-ideas">A few days in…</h2>
    ${ideas.length ? html`<div class="grid">${ideas.map(guideCard)}</div>` : html`<p class="dim">Trip ideas are on their way.</p>`}
  </section>
  <section aria-labelledby="h-places" id="places">
    <h2 id="h-places">Places</h2>
    <ul class="place-list">${places.map((p) => html`<li><a href="/places/${p.slug}"><strong>${p.name}</strong><span>${p.district}</span></a></li>`)}</ul>
  </section>
</div>`;
  return {
    html: page({ title: 'Trips', path, description: 'Road guides for Nepal\'s highways, stop by stop, and trip ideas for Pokhara, Chitwan, Bandipur and beyond.' }, body),
    events: [{ type: 'PAGE_VIEW', path }],
  };
}

/**
 * One guide. A road guide written for both directions reads either way: ?dir=back turns
 * the stops round and counts the kilometres from the other end.
 */
export async function trip(slug: string, back: boolean): Promise<Rendered | null> {
  const g = await data.guide(slug);
  if (!g) return null;
  const twoWay = g.kind === 'ROUTE' && g.direction === 'BOTH' && !!g.route;
  const reversed = twoWay ? back : g.direction === 'REVERSE';
  const from = g.route ? (reversed ? g.route.endPlace : g.route.startPlace) : null;
  const to = g.route ? (reversed ? g.route.startPlace : g.route.endPlace) : null;
  const total = g.route?.distanceKm ?? null;
  const turned = back && twoWay;
  const totalMin = g.route?.typicalHours ? Math.round(g.route.typicalHours * 60) : null;
  // Turned round, times count from the other end too; without a journey time they are left out.
  const stops = turned
    ? [...g.stops].reverse().map((s) => ({ ...s, minutesFromStart: s.minutesFromStart != null && totalMin != null ? Math.max(0, totalMin - s.minutesFromStart) : null }))
    : g.stops;
  const km = (s: { distanceFromStartKm: number | null }) =>
    s.distanceFromStartKm == null ? null : back && twoWay && total != null ? Math.max(0, total - s.distanceFromStartKm) : s.distanceFromStartKm;
  const path = `/trips/${g.slug}${back && twoWay ? '?dir=back' : ''}`;
  const placeAds = g.destination ? await data.liveAds('WEB_DESTINATION_SPONSOR', { destinationId: g.destination.id }) : [];
  const placeAd = adSlot(placeAds[0], path);

  const days = new Map<number, typeof stops>();
  for (const s of stops) {
    const d = g.kind === 'DESTINATION' ? s.dayNumber ?? 1 : 0;
    days.set(d, [...(days.get(d) ?? []), s]);
  }

  const body = html`
<article class="wrap-narrow guide">
  ${crumbs([['/', 'Home'], ['/trips', 'Trips'], ['', g.title]])}
  <header>
    <p class="kicker">${g.kind === 'ROUTE' ? 'Road guide' : 'Trip idea'}${g.destination ? html` · <a href="/places/${g.destination.slug}">${g.destination.name}</a>` : ''}</p>
    <h1>${g.title}</h1>
    ${g.summary ? html`<p class="lede">${g.summary}</p>` : ''}
    ${g.route ? html`<p class="byline">${from} → ${to}${total ? ` · ${total} km` : ''}${g.route.typicalHours ? ` · about ${g.route.typicalHours} hours by bus` : ''} · ${stops.length} stops</p>` : ''}
    ${g.dayCount ? html`<p class="byline">${g.dayCount} days · ${stops.length} places</p>` : ''}
  </header>
  ${twoWay ? html`<nav class="chips chips-wrap" aria-label="Direction">
    <a href="/trips/${g.slug}"${!back ? raw(' aria-current="page"') : ''}>${g.route!.startPlace} → ${g.route!.endPlace}</a>
    <a href="/trips/${g.slug}?dir=back"${back ? raw(' aria-current="page"') : ''}>${g.route!.endPlace} → ${g.route!.startPlace}</a>
  </nav>` : ''}
  ${g.coverImageUrl ? html`<figure class="cover"><img src="${mediaUrl(g.coverImageUrl)}" alt="" width="1200" height="750" decoding="async"></figure>` : ''}
  ${placeAd.html}
  ${[...days.entries()].map(([day, list]) => html`
  <h2>${day ? `Day ${day}` : `On the road from ${from}`}</h2>
  <ol class="road">${list.map((s) => stopRow(s, g.kind === 'ROUTE' ? km(s) : null))}</ol>`)}
  <p class="app-note">On the bus? Scan the code on your seat: this guide follows the road with you, and works offline.</p>
</article>`;

  const ld = {
    '@context': 'https://schema.org', '@type': 'TouristTrip',
    name: g.title, description: g.summary ?? `${from ?? ''} to ${to ?? ''}`.trim(), url: absolute(`/trips/${g.slug}`),
    ...(g.publishedAt ? { datePublished: isoDate(g.publishedAt) } : {}), dateModified: isoDate(g.updatedAt),
    itinerary: {
      '@type': 'ItemList', numberOfItems: stops.length,
      itemListElement: stops.map((s, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': s.business ? 'LocalBusiness' : 'TouristAttraction', name: s.name,
          ...(s.description ? { description: s.description } : {}),
          ...(s.latitude != null && s.longitude != null ? { geo: { '@type': 'GeoCoordinates', latitude: s.latitude, longitude: s.longitude } } : {}),
          ...(s.business ? { url: absolute(`/partners/${s.business.slug}`) } : {}),
        },
      })),
    },
  };

  return {
    html: page({ title: g.title, path: `/trips/${g.slug}`, description: g.summary ?? `A Batoma road guide: ${from} to ${to}.`, image: g.coverImageUrl ? mediaUrl(g.coverImageUrl) : null, ld: [ld] }, body),
    events: [
      { type: 'PAGE_VIEW', path },
      ...placeAd.events,
      // A partner named as a stop has been shown; their report counts it.
      ...partnerEvents(stops.flatMap((s) => (s.business ? [s.business] : [])), path, 'stop'),
    ],
  };
}

export async function place(slug: string): Promise<Rendered | null> {
  const d = await data.destination(slug);
  if (!d) return null;
  const path = `/places/${d.slug}`;
  const [guides, partners, stories, ads] = await Promise.all([
    data.guides({ destinationId: d.id }), data.partners({ destinationId: d.id, take: 9 }), data.articlesAbout(d.id), data.liveAds('WEB_DESTINATION_SPONSOR', { destinationId: d.id }),
  ]);
  const ad = adSlot(ads[0], path);
  const body = html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['/trips#places', 'Places'], ['', d.name]])}
  <header class="page-head">
    <p class="kicker">${d.district}${d.province ? `, ${d.province}` : ''}</p>
    <h1>${d.name}${d.nameNe ? html` <span class="ne" lang="ne">${d.nameNe}</span>` : ''}</h1>
    ${d.description ? html`<p class="lede">${d.description}</p>` : ''}
  </header>
  ${d.heroImageUrl ? html`<figure class="cover"><img src="${mediaUrl(d.heroImageUrl)}" alt="" width="1200" height="600" decoding="async"></figure>` : ''}
  ${ad.html}
  ${guides.length ? html`<section aria-labelledby="h-g"><h2 id="h-g">Trips</h2><div class="grid">${guides.map(guideCard)}</div></section>` : ''}
  ${partners.length ? html`<section aria-labelledby="h-p"><div class="sec-head"><h2 id="h-p">Where to stay, eat and go</h2><a href="/partners?place=${d.slug}">All in ${d.name} →</a></div><div class="grid">${partners.map(partnerCard)}</div></section>` : ''}
  ${stories.length ? html`<section aria-labelledby="h-s"><h2 id="h-s">Stories</h2><div class="grid">${stories.map((a) => articleCard(a))}</div></section>` : ''}
  ${!guides.length && !partners.length && !stories.length ? html`<p class="dim">We are still writing about ${d.name}.</p>` : ''}
</div>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'TouristDestination', name: d.name, url: absolute(path),
    ...(d.description ? { description: d.description } : {}),
    geo: { '@type': 'GeoCoordinates', latitude: d.latitude, longitude: d.longitude },
    containedInPlace: { '@type': 'AdministrativeArea', name: `${d.district}, Nepal` },
  };
  return {
    html: page({ title: d.name, path, description: d.description ?? `${d.name}, ${d.district}: trips, stories and partners from Batoma.`, image: d.heroImageUrl ? mediaUrl(d.heroImageUrl) : null, ld: [ld] }, body),
    events: [{ type: 'PAGE_VIEW', path }, ...ad.events, ...partnerEvents(partners, path), ...articleEvents(stories, path)],
  };
}
