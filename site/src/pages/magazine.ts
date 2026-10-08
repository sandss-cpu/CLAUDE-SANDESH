import * as data from '../data';
import { dayBoth, isoDate } from '../format';
import { esc, html, raw } from '../html';
import { absolute, page, sponsoredLabel } from '../layout';
import { plain, storyHtml } from '../md';
import { adSlot, articleCard, articleEvents, crumbs, img, mediaUrl, newsletterForm, pager, Rendered } from '../parts';
import { PUBLISHER } from './home';

const PER_PAGE = 12;

function sectionNav(cats: Array<{ slug: string; name: string }>, current?: string) {
  return html`<nav class="chips" aria-label="Sections">
  <a href="/stories"${!current ? raw(' aria-current="page"') : ''}>All</a>
  ${cats.map((c) => html`<a href="/stories/section/${c.slug}"${c.slug === current ? raw(' aria-current="page"') : ''}>${c.name}</a>`)}
</nav>`;
}

/** /stories, /stories/section/<slug> and /stories/issue/<n>: the same list, filtered. (Until October 2026 these were under /magazine, which now redirects here.) */
export async function magazine(opts: { page: number; section?: string; issue?: number }): Promise<Rendered | null> {
  const [cats, issues] = await Promise.all([data.categories(), data.issues()]);
  const cat = opts.section ? cats.find((c) => c.slug === opts.section) : undefined;
  const iss = opts.issue != null ? issues.find((i) => i.number === opts.issue) : undefined;
  if ((opts.section && !cat) || (opts.issue != null && !iss)) return null;

  const where = { ...(cat ? { categoryId: cat.id } : {}), ...(iss ? { issueId: iss.id } : {}) };
  const total = await data.articleCount(where);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (opts.page > pages) return null;
  const base = cat ? `/stories/section/${cat.slug}` : iss ? `/stories/issue/${iss.number}` : '/stories';
  const path = opts.page > 1 ? `${base}?page=${opts.page}` : base;

  const [list, sponsorAds, storyAds] = await Promise.all([
    data.articles({ ...where, skip: (opts.page - 1) * PER_PAGE, take: PER_PAGE }),
    cat ? data.liveAds('WEB_SECTION_SPONSOR', { categoryId: cat.id }) : Promise.resolve([]),
    data.liveAds('WEB_SPONSORED_ARTICLE'),
  ]);
  const sponsor = adSlot(sponsorAds[0], path);
  const story = adSlot(storyAds[0], path);
  const title = cat ? cat.name : iss ? `Issue ${iss.number}: ${iss.title}` : 'Stories';
  const description = cat
    ? `${cat.name} stories from Batoma, the Nepal travel magazine.`
    : iss ? `${iss.strapline ?? `Every story in issue ${iss.number} of Batoma.`}` : 'Every Batoma story: the road, food, heritage, festivals, trekking and wildlife of Nepal.';

  const body = html`
<div class="wrap">
  ${crumbs(cat || iss ? [['/', 'Home'], ['/stories', 'Stories'], ['', title]] : [['/', 'Home'], ['', 'Stories']])}
  <header class="page-head">
    <h1>${title}</h1>
    <p class="lede">${description}</p>
  </header>
  ${sectionNav(cats, cat?.slug)}
  ${sponsor.html}
  <h2 class="sr">Stories</h2>
  ${list.length ? html`<div class="grid">${list.slice(0, 3).map((a) => articleCard(a))}</div>
  ${story.html}
  <div class="grid">${list.slice(3).map((a) => articleCard(a))}</div>` : html`<p class="dim">No stories here yet.</p>`}
  ${pager(base, opts.page, pages)}
  ${!cat && !iss && issues.length ? html`<section aria-labelledby="h-issues"><h2 id="h-issues">Issues</h2>
    <ul class="issues">${issues.map((i) => html`<li><a href="/stories/issue/${i.number}"><strong>Issue ${i.number}</strong> ${i.title}</a>${i.season ? html` <span class="dim">${i.season}</span>` : ''}</li>`)}</ul></section>` : ''}
</div>`;

  return {
    html: page({ title, description, path }, body),
    events: [{ type: 'PAGE_VIEW', path }, ...sponsor.events, ...story.events, ...articleEvents(list, path)],
  };
}

export async function article(slug: string): Promise<Rendered | null> {
  const a = await data.article(slug);
  if (!a) return null;
  const path = `/stories/${a.slug}`;
  const [related, sectionAds] = await Promise.all([
    data.articles({ categoryId: a.categoryId ?? undefined, notIds: [a.id], take: 3 }),
    a.categoryId ? data.liveAds('WEB_SECTION_SPONSOR', { categoryId: a.categoryId }) : Promise.resolve([]),
  ]);
  const more = related.length ? related : await data.articles({ notIds: [a.id], take: 3 });
  const handle = a.authorId ? (await data.creatorHandles([a.authorId])).get(a.authorId) : undefined;
  const sectionAd = adSlot(sectionAds[0], path);
  const description = a.summary || a.subtitle || plain(a.body);
  const headings = (a.body.match(/^##\s+.+$/gm) ?? []).map((h) => h.replace(/^##\s+/, '').trim());

  const body = html`
<article class="story wrap-narrow">
  ${crumbs([['/', 'Home'], ['/stories', 'Stories'], ...(a.category ? [[`/stories/section/${a.category.slug}`, a.category.name] as [string, string]] : []), ['', a.title]])}
  <header>
    ${a.isSponsored ? html`<p>${sponsoredLabel(a.sponsor?.name)}</p>` : ''}
    <p class="kicker">${a.category?.name ?? 'Story'}${a.issue ? ` · Issue ${a.issue.number}` : ''}</p>
    <h1>${a.title}</h1>
    ${a.subtitle ? html`<p class="lede">${a.subtitle}</p>` : ''}
    <p class="byline">${a.author?.name ? (handle ? html`By <a href="/creators/${handle}">${a.author.name}</a> <span class="verified">Batoma creator</span> · ` : html`By ${a.author.name} · `) : ''}${a.publishedAt ? html`<time datetime="${isoDate(a.publishedAt)}">${dayBoth(a.publishedAt)}</time> · ` : ''}${a.readMinutes} min read</p>
  </header>
  ${a.coverImageUrl ? html`<figure class="cover">${img(a.coverImageUrl, '', { sizes: '(min-width: 760px) 720px, 100vw', width: 1200, height: 750, lazy: false })}</figure>` : ''}
  ${a.audioUrl ? html`<div class="listen"><p class="kicker">Listen to this story</p><audio controls preload="none" src="${mediaUrl(a.audioUrl)}"></audio></div>` : ''}
  ${a.keyPoints.length ? html`<aside class="brief" aria-label="In brief"><h2>In brief</h2><ul>${a.keyPoints.map((k) => html`<li>${k}</li>`)}</ul></aside>` : ''}
  ${headings.length >= 3 ? html`<nav class="contents" aria-label="In this story"><h2>In this story</h2><ul>${headings.map((h, i) => html`<li><a href="#sec-${i + 1}">${h}</a></li>`)}</ul></nav>` : ''}
  <div class="story-body">${storyHtml(a.body)}</div>
  ${a.destinations.length ? html`<p class="places">Places in this story: ${a.destinations.map((d, i) => html`${i ? ', ' : ''}<a href="/places/${d.destination.slug}">${d.destination.name}</a>`)}</p>` : ''}
  ${a.isSponsored && a.sponsor ? html`<aside class="partner-block">
    <p>${sponsoredLabel(a.sponsor.name)}</p>
    <p>This story was paid for by <strong>${a.sponsor.name}</strong>. Batoma's editors wrote and checked it.</p>
    <a class="btn btn-ghost" href="/partners/${a.sponsor.slug}">About ${a.sponsor.name}</a>
  </aside>` : ''}
  ${sectionAd.html}
  <p class="app-note">Reading on a bus? Scan the code on your seat and this story, and the road ahead, work offline.</p>
</article>
<section class="wrap" aria-labelledby="h-more">
  <div class="sec-head"><h2 id="h-more">More to read</h2><a href="/stories">All stories →</a></div>
  <div class="grid">${more.map((r) => articleCard(r))}</div>
</section>
<div class="wrap">${newsletterForm('article')}</div>`;

  const ld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: a.title, description, inLanguage: 'en',
    mainEntityOfPage: absolute(path),
    ...(a.coverImageUrl ? { image: [mediaUrl(a.coverImageUrl).startsWith('/') ? absolute(mediaUrl(a.coverImageUrl)) : mediaUrl(a.coverImageUrl)] } : {}),
    ...(a.publishedAt ? { datePublished: isoDate(a.publishedAt) } : {}),
    dateModified: isoDate(a.updatedAt),
    author: a.author?.name ? { '@type': 'Person', name: a.author.name, ...(handle ? { url: absolute(`/creators/${handle}`) } : {}) } : PUBLISHER,
    publisher: PUBLISHER,
    ...(a.category ? { articleSection: a.category.name } : {}),
    ...(a.isSponsored && a.sponsor ? { sponsor: { '@type': 'Organization', name: a.sponsor.name, url: absolute(`/partners/${a.sponsor.slug}`) } } : {}),
  };
  const head = raw([
    a.publishedAt ? `<meta property="article:published_time" content="${isoDate(a.publishedAt)}">` : '',
    `<meta property="article:modified_time" content="${isoDate(a.updatedAt)}">`,
    a.category ? `<meta property="article:section" content="${esc(a.category.name)}">` : '',
  ].filter(Boolean).join('\n'));

  return {
    html: page({ title: a.title, description, path, image: a.coverImageUrl ? mediaUrl(a.coverImageUrl) : null, type: 'article', ld: [ld], head }, body),
    events: [
      { type: 'PAGE_VIEW', path, articleId: a.id },
      ...(a.isSponsored && a.sponsor ? [{ type: 'IMPRESSION' as const, path, target: 'sponsored-story', articleId: a.id, businessId: a.sponsor.id }] : []),
      ...sectionAd.events, ...articleEvents(more, path),
    ],
  };
}
