import { config } from '../config';
import * as data from '../data';
import { dayBoth } from '../format';
import { html, Html, raw, safeUrl } from '../html';
import { absolute, joinUrl, page, signInUrl } from '../layout';
import { plain, storyHtml } from '../md';
import { articleCard, crumbs, img, mediaUrl, Rendered, tone } from '../parts';
import { PUBLISHER } from './home';

/**
 * Batoma's creators on the website: those an editor has put here (the role's row-level
 * security decides), with their Batoma stories, journeys with real costs, and posts from the
 * road. Creators sign in and edit in the app; these pages only show.
 */

const n = (v: number) => v.toLocaleString('en-IN');
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const HANDLE = /^[A-Za-z0-9._-]{1,60}$/;

/** What makes Batoma different for a creator, said once and shown wherever it helps. */
const USPS: Array<[string, string]> = [
  ['Read on the road you wrote about', 'Your journeys reach travellers on the buses along that very road, when they scan the code on their seat.'],
  ['Real costs, not just photos', 'Every journey shows what it actually cost in NPR, the days it took, the gear and the tips: what readers can plan with.'],
  ['Your name in the Batoma magazine', 'Our editors choose stories to feature in the magazine, on the website and in the app, with your byline.'],
  ['A verified creator profile', 'A Batoma-checked profile on the web and in the app, with your followers, journeys and posts in one place.'],
];

function avatar(c: { avatarUrl: string | null; displayName: string; handle: string }, size: 'sm' | 'lg' = 'sm'): Html {
  return c.avatarUrl
    ? html`<span class="avatar avatar-${size}">${img(c.avatarUrl, '', { sizes: size === 'lg' ? '120px' : '64px', width: size === 'lg' ? 120 : 64, height: size === 'lg' ? 120 : 64 })}</span>`
    : html`<span class="avatar avatar-${size} ${tone(c.handle)}" aria-hidden="true">${c.displayName.slice(0, 1).toUpperCase()}</span>`;
}

function statsLine(s: data.CreatorStats | undefined): Html {
  if (!s) return raw('');
  return html`<p class="meta">${plural(s.followers, 'follower')} · ${plural(s.journeys, 'journey')} · ${plural(s.posts, 'post')}</p>`;
}

export function creatorCard(c: data.CreatorCard, stats?: data.CreatorStats): Html {
  return html`<article class="card creator-card">
  <a class="card-link" href="/creators/${c.handle}">
    <div class="card-body">
      <div class="creator-head">${avatar(c)}<div>
        <p class="kicker">${c.isFeatured ? raw('<span class="badge">Featured creator</span>') : 'Batoma creator'}</p>
        <h3>${c.displayName}</h3>
        <p class="meta">@${c.handle}${c.homeBase ? ` · ${c.homeBase}` : ''}</p>
      </div></div>
      ${c.headline ? html`<p class="dim">${c.headline}</p>` : ''}
      ${c.specialities.length ? html`<p class="tags">${c.specialities.slice(0, 4).map((t) => html`<span>${t}</span>`)}</p>` : ''}
      ${statsLine(stats)}
    </div>
  </a>
</article>`;
}

const ctas = () => html`<p class="cta-row">
  <a class="btn" href="/creators/join">Become a Batoma creator</a>
  <a class="btn btn-ghost" href="${signInUrl}">Creator sign in</a>
</p>`;

/** /creators: everyone an editor has put on the website, featured first. */
export async function creatorsPage(): Promise<Rendered> {
  const list = await data.creators();
  const stats = await data.creatorStats(list.map((c) => c.id));
  const body = html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['', 'Creators']])}
  <header class="page-head">
    <h1>Batoma creators</h1>
    <p class="lede">Travellers who know Nepal's roads, writing what it was really like: the bus they took, where they stopped, what it cost. Each one is checked by Batoma.</p>
    ${ctas()}
  </header>
  <h2 class="sr">Creators</h2>
  ${list.length ? html`<div class="grid">${list.map((c) => creatorCard(c, stats.get(c.id)))}</div>`
    : html`<p class="dim">Our first creators are on their way. <a href="/creators/join">Become one of them</a>.</p>`}
  <aside class="note"><strong>Writing about Nepal?</strong> ${USPS[0][1]} <a href="/creators/join">See what Batoma creators get</a>.</aside>
</div>`;
  return {
    html: page({ title: 'Creators', path: '/creators', description: 'Batoma creators: travellers writing about Nepal\'s roads, with real costs, the bus they took and where they stopped.' }, body),
    events: [{ type: 'PAGE_VIEW', path: '/creators' }],
  };
}

/** /creators/join: the creator programme, and the way in through the app. */
export function joinPage(): Rendered {
  const body = html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['/creators', 'Creators'], ['', 'Become a creator']])}
  <h1>Become a Batoma creator</h1>
  <p class="lede">Batoma is the travel magazine people read on the bus in Nepal. As a creator, your trips are read by the travellers who need them, on the road they are about.</p>
  <ul class="values">${USPS.map(([t, d]) => html`<li><strong>${t}</strong> ${d}</li>`)}</ul>
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Create a Batoma account</strong>, or sign in if you have one.</li>
    <li><strong>Apply for a creator profile</strong> in the creator panel: your name, handle, what you travel for, where you are based.</li>
    <li><strong>Publish journeys</strong> from your posts: the road, the days, what it cost, the gear and your tips. You can start straight away.</li>
    <li><strong>Batoma checks your profile.</strong> Once approved, readers in the app can follow you, and our editors choose creators and stories for this website and the magazine.</li>
  </ol>
  <p class="cta-row">
    <a class="btn" href="${joinUrl}">Create an account and apply</a>
    <a class="btn btn-ghost" href="${signInUrl}">I have an account: sign in</a>
  </p>
  <p class="small">Prefer to send one story? <a href="/write">Write a trip</a> from this website; no profile needed.</p>
</div>`;
  return {
    html: page({ title: 'Become a creator', path: '/creators/join', description: 'Write for Batoma: your journeys read on the bus, real costs, your byline in the magazine and a verified creator profile.' }, body),
    events: [{ type: 'PAGE_VIEW', path: '/creators/join' }],
  };
}

/** The total a journey cost, when any part of it is known. */
export function journeyTotal(j: { transportNpr: number | null; stayNpr: number | null; foodNpr: number | null; permitsNpr: number | null; otherNpr: number | null }): number | null {
  const parts = [j.transportNpr, j.stayNpr, j.foodNpr, j.permitsNpr, j.otherNpr].filter((v): v is number => v != null);
  return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}
const where = (j: data.JourneyCard) => (j.route ? `${j.route.startPlace} → ${j.route.endPlace}` : j.destination?.name ?? '');

function journeyCard(j: data.JourneyCard, handle: string): Html {
  const total = journeyTotal(j);
  return html`<article class="card">
  <a class="card-link" href="/creators/${handle}/${j.slug}">
    ${j.coverImageUrl ? html`<div class="pic">${img(j.coverImageUrl, '', { sizes: '(min-width: 980px) 360px, (min-width: 640px) 50vw, 100vw', width: 640, height: 400 })}</div>`
      : html`<div class="pic ph ${tone(j.slug)}" aria-hidden="true"><span>${where(j)}</span></div>`}
    <div class="card-body">
      <p class="kicker">Journey${where(j) ? ` · ${where(j)}` : ''}</p>
      <h3>${j.title}</h3>
      ${j.summary ? html`<p class="dim">${j.summary}</p>` : ''}
      <p class="meta">${[j.dayCount ? plural(j.dayCount, 'day') : '', total != null ? `NPR ${n(total)} in all` : ''].filter(Boolean).join(' · ')}</p>
    </div>
  </a>
</article>`;
}

function postBlock(p: data.PublicPost): Html {
  const photos = p.photos.length ? p.photos : p.coverImageUrl ? [{ url: p.coverImageUrl, caption: null }] : [];
  return html`<article class="road-post">
  <h3>${p.title}</h3>
  <p class="meta">${[p.locationName, p.publishedAt ? dayBoth(p.publishedAt) : ''].filter(Boolean).join(' · ')}</p>
  ${photos.length ? html`<div class="photo-grid">${photos.slice(0, 4).map((ph) => html`<figure>${img(ph.url, ph.caption ?? '', { sizes: '(min-width: 760px) 340px, 50vw', width: 480, height: 360 })}${ph.caption ? html`<figcaption>${ph.caption}</figcaption>` : ''}</figure>`)}</div>` : ''}
  <div class="story-body">${storyHtml(p.body)}</div>
</article>`;
}

/** Links to a creator's own sites: a full https address, or a plain handle made into one. */
function links(c: { websiteUrl: string | null; instagram: string | null; youtube: string | null }): Html[] {
  const out: Html[] = [];
  if (c.websiteUrl && safeUrl(c.websiteUrl) !== '#') out.push(html`<a href="${safeUrl(c.websiteUrl)}" rel="nofollow noopener external">Website ↗</a>`);
  const ig = c.instagram?.replace(/^@/, '');
  if (ig) out.push(HANDLE.test(ig) ? html`<a href="https://www.instagram.com/${ig}/" rel="nofollow noopener external">Instagram @${ig} ↗</a>` : html`<span>Instagram ${ig}</span>`);
  const yt = c.youtube?.replace(/^@/, '');
  if (yt) out.push(HANDLE.test(yt) ? html`<a href="https://www.youtube.com/@${yt}" rel="nofollow noopener external">YouTube @${yt} ↗</a>` : html`<span>YouTube ${yt}</span>`);
  return out;
}
const sameAs = (c: { websiteUrl: string | null; instagram: string | null; youtube: string | null }) => [
  c.websiteUrl && safeUrl(c.websiteUrl) !== '#' ? c.websiteUrl : null,
  c.instagram && HANDLE.test(c.instagram.replace(/^@/, '')) ? `https://www.instagram.com/${c.instagram.replace(/^@/, '')}/` : null,
  c.youtube && HANDLE.test(c.youtube.replace(/^@/, '')) ? `https://www.youtube.com/@${c.youtube.replace(/^@/, '')}` : null,
].filter(Boolean);

/** /creators/<handle>: the showcase. */
export async function creatorPage(handle: string): Promise<Rendered | null> {
  const c = await data.creator(handle);
  if (!c) return null;
  const path = `/creators/${c.handle}`;
  const [{ stories, journeys, posts }, stats] = await Promise.all([data.creatorWork(c), data.creatorStats([c.id])]);
  const s = stats.get(c.id);
  const ext = links(c);

  const body = html`
<div class="creator-cover${c.coverUrl ? '' : ` ${tone(c.handle)}`}">${c.coverUrl ? img(c.coverUrl, '', { sizes: '100vw', width: 1600, height: 500, lazy: false }) : ''}</div>
<div class="wrap">
  ${crumbs([['/', 'Home'], ['/creators', 'Creators'], ['', c.displayName]])}
  <header class="creator-profile">
    ${avatar(c, 'lg')}
    <div>
      <p class="kicker">${c.isFeatured ? raw('<span class="badge">Featured creator</span>') : ''}<span class="verified">Batoma creator</span>${stories.length ? raw(' <span class="badge badge-ink">Featured in Batoma</span>') : ''}</p>
      <h1>${c.displayName}</h1>
      <p class="meta">@${c.handle}${c.homeBase ? ` · based in ${c.homeBase}` : ''}${c.languages.length ? ` · writes in ${c.languages.join(', ')}` : ''}</p>
      ${c.headline ? html`<p class="lede">${c.headline}</p>` : ''}
    </div>
  </header>
  ${s ? html`<ul class="figures creator-figures" aria-label="In numbers">
    <li><strong>${n(s.followers)}</strong><span>${s.followers === 1 ? 'follower' : 'followers'} in the app</span></li>
    <li><strong>${n(s.journeys)}</strong><span>${s.journeys === 1 ? 'journey' : 'journeys'}</span></li>
    <li><strong>${n(s.posts)}</strong><span>${s.posts === 1 ? 'post' : 'posts'} from the road</span></li>
    <li><strong>${n(stories.length)}</strong><span>${stories.length === 1 ? 'story' : 'stories'} in Batoma</span></li>
  </ul>` : ''}
  ${c.bio ? html`<div class="creator-bio story-body">${storyHtml(c.bio)}</div>` : ''}
  ${c.specialities.length ? html`<p class="tags">${c.specialities.map((t) => html`<span>${t}</span>`)}</p>` : ''}
  ${ext.length ? html`<p class="creator-links">${ext.map((l, i) => html`${i ? ' · ' : ''}${l}`)}</p>` : ''}

  ${stories.length ? html`<section aria-labelledby="h-stories"><div class="sec-head"><h2 id="h-stories">Stories in Batoma</h2></div>
    <div class="grid">${stories.map((a) => articleCard(a))}</div></section>` : ''}
  ${journeys.length ? html`<section aria-labelledby="h-journeys"><div class="sec-head"><h2 id="h-journeys">Journeys</h2></div>
    <p class="dim">The road, the days and what it really cost.</p>
    <div class="grid">${journeys.map((j) => journeyCard(j, c.handle))}</div></section>` : ''}
  ${posts.length ? html`<section aria-labelledby="h-road"><div class="sec-head"><h2 id="h-road">From the road</h2></div>
    <div class="road-posts">${posts.map(postBlock)}</div></section>` : ''}
  ${!stories.length && !journeys.length && !posts.length ? html`<p class="dim">${c.displayName}'s first journeys are on their way.</p>` : ''}
  <aside class="note">Follow ${c.displayName} in the <a href="${config.appUrl}/creator.html?handle=${encodeURIComponent(c.handle)}">Batoma app</a>. Writing about Nepal yourself? <a href="/creators/join">Become a Batoma creator</a>.</aside>
</div>`;

  const ld = {
    '@context': 'https://schema.org', '@type': 'ProfilePage', url: absolute(path),
    ...(c.updatedAt ? { dateModified: c.updatedAt.toISOString() } : {}),
    mainEntity: {
      '@type': 'Person', name: c.displayName, alternateName: `@${c.handle}`, url: absolute(path),
      ...(c.headline || c.bio ? { description: c.headline || plain(c.bio) } : {}),
      ...(c.avatarUrl ? { image: mediaUrl(c.avatarUrl).startsWith('/') ? absolute(mediaUrl(c.avatarUrl)) : mediaUrl(c.avatarUrl) } : {}),
      ...(c.homeBase ? { homeLocation: { '@type': 'Place', name: c.homeBase } } : {}),
      ...(sameAs(c).length ? { sameAs: sameAs(c) } : {}),
      ...(s ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: s.followers } } : {}),
    },
  };
  return {
    html: page({
      title: `${c.displayName} (@${c.handle})`, path, type: 'profile',
      description: c.headline || plain(c.bio) || `${c.displayName}'s journeys and stories on Batoma.`,
      image: c.avatarUrl ? mediaUrl(c.avatarUrl) : null, ld: [ld],
    }, body),
    events: [{ type: 'PAGE_VIEW', path }],
  };
}

/** /creators/<handle>/<journey>: the road, the days, the costs, then the trip day by day. */
export async function journeyPage(handle: string, slug: string): Promise<Rendered | null> {
  const j = await data.journey(handle, slug);
  if (!j || j.creator.handle !== handle.toLowerCase()) return null;
  const path = `/creators/${j.creator.handle}/${j.slug}`;
  const total = journeyTotal(j);
  const costs: Array<[string, number | null]> = [['Transport', j.transportNpr], ['Stay', j.stayNpr], ['Food', j.foodNpr], ['Permits and fees', j.permitsNpr], ['Other', j.otherNpr]];
  const place = where(j);

  const body = html`
<article class="story wrap-narrow">
  ${crumbs([['/', 'Home'], ['/creators', 'Creators'], [`/creators/${j.creator.handle}`, j.creator.displayName], ['', j.title]])}
  <header>
    <p class="kicker">Journey${place ? ` · ${place}` : ''}</p>
    <h1>${j.title}</h1>
    ${j.summary ? html`<p class="lede">${j.summary}</p>` : ''}
    <p class="byline">By <a href="/creators/${j.creator.handle}">${j.creator.displayName}</a> <span class="verified">Batoma creator</span>${j.publishedAt ? html` · <time datetime="${j.publishedAt.toISOString()}">${dayBoth(j.publishedAt)}</time>` : ''}</p>
  </header>
  ${j.coverImageUrl ? html`<figure class="cover">${img(j.coverImageUrl, '', { sizes: '(min-width: 760px) 720px, 100vw', width: 1200, height: 750, lazy: false })}</figure>` : ''}
  <dl class="facts">
    ${place ? html`<dt>Where</dt><dd>${place}${j.destination ? html` · <a href="/places/${j.destination.slug}">About ${j.destination.name}</a>` : ''}</dd>` : ''}
    ${j.dayCount ? html`<dt>How long</dt><dd>${plural(j.dayCount, 'day')}</dd>` : ''}
    ${j.startedOn ? html`<dt>When</dt><dd>${dayBoth(j.startedOn)}</dd>` : ''}
  </dl>
  ${total != null ? html`<section class="costs" aria-labelledby="h-costs"><h2 id="h-costs">What it cost</h2>
    <table><tbody>${costs.filter(([, v]) => v != null).map(([label, v]) => html`<tr><th scope="row">${label}</th><td>NPR ${n(v!)}</td></tr>`)}</tbody>
    <tfoot><tr><th scope="row">In all</th><td>NPR ${n(total)}</td></tr></tfoot></table>
    <p class="small">What ${j.creator.displayName} paid, for one person unless the journey says otherwise. Prices change; check before you go.</p></section>` : ''}
  ${j.gear.length ? html`<section aria-labelledby="h-gear"><h2 id="h-gear">Worth carrying</h2><ul>${j.gear.map((g) => html`<li>${g}</li>`)}</ul></section>` : ''}
  ${j.tips ? html`<section aria-labelledby="h-tips"><h2 id="h-tips">Tips</h2><div class="story-body">${storyHtml(j.tips)}</div></section>` : ''}
  ${j.entries.length ? html`<section aria-labelledby="h-days"><h2 id="h-days">Day by day</h2>
    ${j.entries.map((e) => html`<div class="journey-entry">${e.dayNumber ? html`<p class="kicker">Day ${e.dayNumber}</p>` : ''}${e.note ? html`<p class="dim">${e.note}</p>` : ''}${postBlock(e.post)}</div>`)}</section>` : ''}
  <aside class="note">More from <a href="/creators/${j.creator.handle}">${j.creator.displayName}</a>. On a bus${j.route ? ` from ${j.route.startPlace}` : ''}? Scan the code on your seat and Batoma's stories for the road work offline.</aside>
</article>`;

  const image = j.coverImageUrl ? mediaUrl(j.coverImageUrl) : null;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article', headline: j.title, url: absolute(path), mainEntityOfPage: absolute(path),
    ...(j.summary ? { description: j.summary } : {}),
    ...(image ? { image: [image.startsWith('/') ? absolute(image) : image] } : {}),
    ...(j.publishedAt ? { datePublished: j.publishedAt.toISOString() } : {}),
    dateModified: j.updatedAt.toISOString(),
    author: { '@type': 'Person', name: j.creator.displayName, url: absolute(`/creators/${j.creator.handle}`) },
    publisher: PUBLISHER,
    ...(place ? { contentLocation: { '@type': 'Place', name: place } } : {}),
  };
  return {
    html: page({ title: j.title, path, type: 'article', description: j.summary || `${j.creator.displayName}'s journey${place ? `: ${place}` : ''}, with what it cost.`, image, ld: [ld] }, body),
    events: [{ type: 'PAGE_VIEW', path }],
  };
}
