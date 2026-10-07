import * as data from '../data';
import { badge, EVENT_KIND, eventWhen, isoDate, kathmanduDay, monthAd, timeNpt } from '../format';
import { html, Html, raw, safeUrl } from '../html';
import { absolute, page } from '../layout';
import { plain, storyHtml } from '../md';
import { crumbs, img, mediaUrl, Rendered } from '../parts';
import { PUBLISHER } from './home';

const today = () => kathmanduDay(new Date());
/** Over once its last day has passed in Kathmandu. */
const finished = (e: { startsAt: Date; endsAt: Date | null }) => kathmanduDay(e.endsAt ?? e.startsAt) < today();
const started = (e: { startsAt: Date }) => kathmanduDay(e.startsAt) < today();

/** The short "when" on a card: the time for a one-day event, the days for a longer one. */
function whenShort(e: data.EventCard): string {
  const multi = e.endsAt && kathmanduDay(e.endsAt) !== kathmanduDay(e.startsAt);
  if (multi) {
    const a = badge(e.startsAt);
    const b = badge(e.endsAt!);
    return a.month === b.month ? `${a.day}–${b.day} ${a.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
  }
  if (e.allDay) return 'All day';
  return e.endsAt ? `${timeNpt(e.startsAt)}–${timeNpt(e.endsAt)}` : timeNpt(e.startsAt);
}

export function eventCard(e: data.EventCard): Html {
  const b = badge(e.startsAt);
  const cancelled = e.status === 'CANCELLED';
  return html`<article class="event${cancelled ? ' event-off' : ''}">
  <a class="event-link" href="/events/${e.slug}">
    <p class="event-date" aria-hidden="true"><span>${b.weekday}</span><strong>${b.day}</strong><span>${b.month}</span></p>
    <div class="event-body">
      <p class="kicker">${EVENT_KIND[e.category] ?? 'Event'}${cancelled ? raw(' <span class="badge badge-off">Cancelled</span>') : e.isFeatured ? raw(' <span class="badge">Featured</span>') : ''}</p>
      <h3>${e.title}</h3>
      <p class="dim">${e.summary}</p>
      <p class="meta"><time datetime="${isoDate(e.startsAt)}">${whenShort(e)}</time> · ${e.venue ? `${e.venue}, ` : ''}${e.city}${e.priceLabel ? ` · ${e.priceLabel}` : ''}</p>
    </div>
  </a>
</article>`;
}

/** /events: everything still to come, by month, with "on now" first. Filtered by town and month, without script. */
export async function events(filters: { city?: string; month?: string }): Promise<Rendered> {
  const cities = await data.eventCities();
  const city = cities.find((c) => c.toLowerCase() === (filters.city ?? '').toLowerCase());
  const month = /^\d{4}-\d{2}$/.test(filters.month ?? '') ? filters.month : undefined;
  const [list, all] = await Promise.all([data.events({ city, month }), data.events({ city })]);
  const months = [...new Set(all.map((e) => kathmanduDay(started(e) ? new Date() : e.startsAt).slice(0, 7)))];
  const path = `/events${city || month ? `?${new URLSearchParams({ ...(city ? { city } : {}), ...(month ? { month } : {}) })}` : ''}`;
  const monthName = (ym: string) => monthAd(new Date(`${ym}-15T06:00:00Z`));

  const now = list.filter(started);
  const later = list.filter((e) => !started(e));
  const groups = new Map<string, data.EventCard[]>();
  for (const e of later) {
    const key = kathmanduDay(e.startsAt).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const title = ['Events', city ? `in ${city}` : '', month ? `· ${monthName(month)}` : ''].filter(Boolean).join(' ');

  const body = html`
<div class="wrap">
  ${crumbs(city || month ? [['/', 'Home'], ['/events', 'Events'], ['', title.replace(/^Events /, '')]] : [['/', 'Home'], ['', 'Events']])}
  <header class="page-head">
    <h1>${city || month ? title : 'Events and happenings'}</h1>
    <p class="lede">Festivals, music, food, markets and more in Nepal's towns and cities: what is on, where and when. Every listing is checked by Batoma; times are Kathmandu time.</p>
  </header>
  <form class="filters" method="get" action="/events">
    <div class="field">
      <label for="f-city">Town or city</label>
      <select id="f-city" name="city"><option value="">Everywhere</option>${cities.map((c) => html`<option value="${c}"${c === city ? raw(' selected') : ''}>${c}</option>`)}</select>
    </div>
    <div class="field">
      <label for="f-month">When</label>
      <select id="f-month" name="month"><option value="">Any time</option>${months.map((m) => html`<option value="${m}"${m === month ? raw(' selected') : ''}>${monthName(m)}</option>`)}</select>
    </div>
    <button class="btn" type="submit">Show</button>
  </form>
  ${!list.length ? html`<p class="dim">Nothing is listed ${city ? `in ${city} ` : ''}${month ? `in ${monthName(month)} ` : ''}yet. ${city || month ? html`<a href="/events">See everything coming up</a>, or ` : ''}tell us about an event on the <a href="/contact">contact page</a>.</p>` : ''}
  ${now.length ? html`<section aria-labelledby="h-now"><h2 id="h-now">On now</h2><div class="events">${now.map(eventCard)}</div></section>` : ''}
  ${[...groups].map(([ym, items]) => html`<section aria-labelledby="h-${ym}"><h2 id="h-${ym}">${monthName(ym)}</h2><div class="events">${items.map(eventCard)}</div></section>`)}
  <aside class="note">Organising something travellers should know about? Tell us on the <a href="/contact">contact page</a> and we will look at listing it.</aside>
</div>`;

  return {
    html: page({
      title, path,
      description: `What is on in ${city ?? "Nepal's towns and cities"}${month ? ` in ${monthName(month)}` : ''}: festivals, music, food, markets and more, listed by Batoma.`,
    }, body),
    events: [{ type: 'PAGE_VIEW', path: '/events' }],
  };
}

/** One event: when (AD and BS), where, what it costs, a calendar file and, for search engines, Event data. */
export async function event(slug: string): Promise<Rendered | null> {
  const e = await data.event(slug);
  if (!e) return null;
  const path = `/events/${e.slug}`;
  const when = eventWhen(e);
  const cancelled = e.status === 'CANCELLED';
  const over = finished(e);
  const where = [e.venue, e.address, e.city].filter(Boolean).join(', ');
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
  const more = await data.events({ city: e.city, take: 3, notId: e.id });

  const body = html`
<article class="story wrap-narrow">
  ${crumbs([['/', 'Home'], ['/events', 'Events'], ['', e.title]])}
  <header>
    <p class="kicker">${EVENT_KIND[e.category] ?? 'Event'} · ${e.city}${cancelled ? raw(' <span class="badge badge-off">Cancelled</span>') : ''}</p>
    <h1>${e.title}</h1>
    ${e.titleNe ? html`<p class="lede" lang="ne">${e.titleNe}</p>` : ''}
    <p class="lede">${e.summary}</p>
  </header>
  ${cancelled ? html`<p class="notice" role="note"><strong>This event has been cancelled.</strong> It stays listed so that anyone planning to go knows.</p>`
    : over ? html`<p class="notice" role="note"><strong>This event has finished.</strong> <a href="/events">See what is coming up</a>.</p>` : ''}
  ${e.imageUrl ? html`<figure class="cover">${img(e.imageUrl, '', { sizes: '(min-width: 760px) 720px, 100vw', width: 1200, height: 750, lazy: false })}</figure>` : ''}
  <dl class="facts">
    <dt>When</dt><dd>${when.ad}${when.bs ? html`<br><span class="dim">${when.bs}</span>` : ''}</dd>
    <dt>Where</dt><dd>${where}${e.destination ? html` · <a href="/places/${e.destination.slug}">About ${e.destination.name}</a>` : ''}</dd>
    ${e.priceLabel ? html`<dt>Price</dt><dd>${e.priceLabel}</dd>` : ''}
    ${e.organiser ? html`<dt>Organised by</dt><dd>${e.organiser}</dd>` : ''}
  </dl>
  <p class="actions">
    ${!cancelled && !over ? html`<a class="btn" href="/events/${e.slug}/calendar.ics" download>Add to your calendar</a>` : ''}
    ${e.url && !cancelled ? html`<a class="btn btn-ghost" href="${safeUrl(e.url)}" rel="nofollow noopener external">Tickets and details ↗</a>` : ''}
    <a class="btn btn-ghost" href="${map}" rel="noopener external">Map ↗</a>
  </p>
  ${e.description ? html`<div class="story-body">${storyHtml(e.description)}</div>` : ''}
  <p class="small">Details can change. Check with the organiser before you travel.</p>
</article>
${more.length ? html`<section class="wrap" aria-labelledby="h-more">
  <div class="sec-head"><h2 id="h-more">More in ${e.city}</h2><a href="/events?city=${encodeURIComponent(e.city)}">All events in ${e.city} →</a></div>
  <div class="events">${more.map(eventCard)}</div>
</section>` : ''}`;

  // All-day events carry dates; timed ones the Kathmandu offset, so search engines show local times.
  const local = (d: Date) => (e.allDay ? kathmanduDay(d) : `${kathmanduDay(d)}T${timeNpt(d)}:00+05:45`);
  const image = e.imageUrl ? mediaUrl(e.imageUrl) : null;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Event',
    name: e.title, description: e.summary || plain(e.description), url: absolute(path),
    startDate: local(e.startsAt), ...(e.endsAt ? { endDate: local(e.endsAt) } : {}),
    eventStatus: cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place', name: e.venue ?? e.city,
      address: { '@type': 'PostalAddress', ...(e.address ? { streetAddress: e.address } : {}), addressLocality: e.city, addressCountry: 'NP' },
    },
    ...(image ? { image: [image.startsWith('/') ? absolute(image) : image] } : {}),
    ...(e.organiser ? { organizer: { '@type': 'Organization', name: e.organiser, ...(e.url ? { url: e.url } : {}) } } : {}),
    ...(e.url ? { offers: { '@type': 'Offer', url: e.url, ...(e.priceLabel ? { description: e.priceLabel } : {}) } } : {}),
    ...(/\bfree\b/i.test(e.priceLabel ?? '') ? { isAccessibleForFree: true } : {}),
    publisher: PUBLISHER,
  };
  return {
    html: page({ title: e.title, description: e.summary, path, image, ld: [ld] }, body),
    events: [{ type: 'PAGE_VIEW', path }],
  };
}

/** The next few events, for the home page. */
export const comingUp = (take = 3) => data.events({ take });
