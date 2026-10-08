import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { cacheSize, purge } from '../src/cache';
import { config } from '../src/config';
import { db } from '../src/db';
import { visitHash } from '../src/events';
import { formToken, resetLimits } from '../src/forms';
import { createApp } from '../src/server';

/**
 * The website against the real database: pages through the read-only role, fixtures set
 * up and removed through the owner connection (OWNER_DATABASE_URL).
 */
const owner = new PrismaClient({ datasources: { db: { url: process.env.OWNER_DATABASE_URL } } });
const UA = 'Mozilla/5.0 (Linux; Android 14) BatomaSiteTest/1.0';
let base = '';
let close = () => {};
const made: { ads: string[]; targets: string[]; events: string[] } = { ads: [], targets: [], events: [] };
const startedAt = Date.now();

/** The visit codes this suite's requests were counted under, so its rows can be removed. */
function ourVisits(): string[] {
  const out: string[] = [];
  for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1'])
    for (const ua of [UA, `${UA} other`])
      for (const at of [startedAt, Date.now()])
        out.push(visitHash({ ip, get: (h: string) => (h === 'user-agent' ? ua : undefined) } as never, at));
  return out;
}

const get = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) } });
const text = async (path: string) => { const r = await get(path); return { status: r.status, body: await r.text(), res: r }; };
const form = (fields: Record<string, string>) => ({
  method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
});

before(async () => {
  assert.ok(process.env.OWNER_DATABASE_URL, 'OWNER_DATABASE_URL is needed to set up fixtures');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(async () => {
  if (made.ads.length) {
    await owner.siteEvent.deleteMany({ where: { adId: { in: made.ads } } });
    await owner.advertisement.deleteMany({ where: { id: { in: made.ads } } });
  }
  if (made.targets.length) await owner.siteEvent.deleteMany({ where: { target: { in: made.targets } } });
  if (made.events.length) await owner.event.deleteMany({ where: { id: { in: made.events } } });
  await owner.siteEvent.deleteMany({ where: { sessionHash: { in: ourVisits() }, createdAt: { gte: new Date(startedAt - 1000) } } });
  close();
  await owner.$disconnect();
  await db.$disconnect();
});

describe('what the public may reach', () => {
  test('a crawl of the site finds no bus, QR, fleet or /b/ links, and no dead internal links', async () => {
    const seen = new Set<string>();
    const queue = ['/'];
    const forbidden = /(?:href|src|action)="[^"]*(?:\/b\/|\/r\/|bus\.html|scan\.html|owner\.html|fleet|[?&/]qr\b|\/qr)/i;
    const dead: string[] = [];
    while (queue.length && seen.size < 200) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const { status, body } = await text(path);
      if (status !== 200) { dead.push(`${path} → ${status}`); continue; }
      assert.doesNotMatch(body, forbidden, `forbidden link on ${path}`);
      for (const [, href] of body.matchAll(/href="(\/[^"#]*)/g)) {
        const clean = href.replace(/&amp;/g, '&');
        if (/^\/(go|css|fonts|icons)\//.test(clean) || clean.startsWith('/newsletter/')) continue;
        if (!seen.has(clean)) queue.push(clean);
      }
    }
    assert.ok(seen.size > 20, `crawled only ${seen.size} pages`);
    assert.deepEqual(dead, []);
  });

  test('pages carry a strict CSP and no script at all', async () => {
    const { body, res } = await text('/');
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    // The only script elements are JSON-LD data blocks.
    for (const [tag] of body.matchAll(/<script[^>]*>/g)) assert.equal(tag, '<script type="application/ld+json">');
    assert.doesNotMatch(body, /\son[a-z]+="/i, 'no inline handlers');
    assert.doesNotMatch(body, /\sstyle="/i, 'no inline styles');
  });

  test('robots.txt keeps crawlers off /go/ and points at the sitemap; the sitemap lists stories', async () => {
    const robots = await text('/robots.txt');
    assert.match(robots.body, /Disallow: \/go\//);
    assert.match(robots.body, /Sitemap: .*\/sitemap\.xml/);
    const art = await owner.article.findFirstOrThrow({ where: { status: 'PUBLISHED' }, select: { slug: true } });
    const map = await text('/sitemap.xml');
    assert.ok(map.body.includes(`/stories/${art.slug}</loc>`));
  });

  test('a draft story is not served', async () => {
    const draft = await owner.article.findFirst({ where: { status: { not: 'PUBLISHED' } }, select: { slug: true } });
    if (!draft) return;
    assert.equal((await get(`/stories/${draft.slug}`)).status, 404);
  });

  test('a published story taken off the website is not served, and the read-only role cannot see it', async () => {
    const art = await owner.article.findFirstOrThrow({ where: { status: 'PUBLISHED', onWebsite: true }, select: { id: true, slug: true } });
    await owner.article.update({ where: { id: art.id }, data: { onWebsite: false } });
    try {
      purge();
      assert.equal((await get(`/stories/${art.slug}`)).status, 404);
      assert.ok(!(await text('/sitemap.xml')).body.includes(`/stories/${art.slug}</loc>`));
      // Row-level security, not only the query's filter: even asking for it outright finds nothing.
      assert.equal(await db.article.findFirst({ where: { id: art.id }, select: { id: true } }), null);
    } finally {
      await owner.article.update({ where: { id: art.id }, data: { onWebsite: true } });
      purge();
    }
    assert.equal((await get(`/stories/${art.slug}`)).status, 200);
  });
});

describe('an article page without JavaScript', () => {
  test('has the title, the body, share tags and Article JSON-LD in its source', async () => {
    const a = await owner.article.findFirstOrThrow({
      where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, select: { slug: true, title: true, body: true },
    });
    const { status, body } = await text(`/stories/${a.slug}`);
    assert.equal(status, 200);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(body.includes(`<h1>${esc(a.title)}</h1>`));
    const firstWords = a.body.split(/\n{2,}/).find((p) => !p.startsWith('#'))!.replace(/\*+/g, '').split(/\s+/).slice(0, 6).join(' ');
    assert.ok(body.includes(esc(firstWords)), 'body text is in the page');
    assert.ok(body.includes(`<meta property="og:title" content="${esc(a.title)}">`));
    assert.ok(body.includes('<meta property="og:type" content="article">'));
    assert.match(body, /<link rel="canonical" href="[^"]+\/stories\//);
    const ld = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(([, j]) => JSON.parse(j));
    const article = ld.find((d) => d['@type'] === 'Article');
    assert.ok(article, 'Article JSON-LD');
    assert.equal(article.headline, a.title);
    assert.ok(article.publisher?.name === 'Batoma');
  });
});

describe('paid placements', () => {
  let liveId = '';
  let expiredTitle = '';
  let futureTitle = '';
  let liveTitle = '';

  before(async () => {
    const admin = await owner.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
    const day = 86_400_000;
    const now = Date.now();
    const stamp = now.toString(36);
    liveTitle = `Test live deal ${stamp}`;
    expiredTitle = `Test ended deal ${stamp}`;
    futureTitle = `Test future hero ${stamp}`;
    const common = { advertiserName: 'Test Partner', imageUrl: 'https://example.com/ad.jpg', durationUnit: 'DAY' as const, durationCount: 1, createdById: admin.id };
    const live = await owner.advertisement.create({ data: { ...common, title: liveTitle, placement: 'WEB_DEALS', startsAt: new Date(now - day), endsAt: new Date(now + day), linkType: 'EXTERNAL', externalUrl: 'https://example.com/offer?x=1' } });
    const ended = await owner.advertisement.create({ data: { ...common, title: expiredTitle, placement: 'WEB_DEALS', startsAt: new Date(now - 3 * day), endsAt: new Date(now - day), linkType: 'OVERVIEW' } });
    const future = await owner.advertisement.create({ data: { ...common, title: futureTitle, placement: 'WEB_HOME_HERO', startsAt: new Date(now + day), endsAt: new Date(now + 2 * day), linkType: 'OVERVIEW' } });
    liveId = live.id;
    made.ads.push(live.id, ended.id, future.id);
    purge();
  });

  test('shows only in its own slot, only inside its dates, and always labelled', async () => {
    const deals = await text('/deals');
    assert.ok(deals.body.includes(liveTitle), 'live ad in its slot');
    assert.ok(!deals.body.includes(expiredTitle), 'ended ad not shown');
    const slot = deals.body.slice(deals.body.indexOf('<aside class="ad'), deals.body.indexOf(liveTitle));
    assert.match(slot, /<span class="sponsored">Sponsored · Test Partner<\/span>/);
    assert.match(deals.body, new RegExp(`href="/go/ad/${liveId}" rel="sponsored noopener"`));
    const home = await text('/');
    assert.ok(!home.body.includes(liveTitle), 'a deals ad is not on the home page');
    assert.ok(!home.body.includes(futureTitle), 'an ad that has not started is not shown');
    const stories = await text('/stories');
    assert.ok(!stories.body.includes(liveTitle));
  });

  test('/go/ad counts one click per visit and redirects with UTM tags', async () => {
    const count = () => owner.siteEvent.count({ where: { type: 'CLICK', adId: liveId } });
    const before = await count();
    const first = await get(`/go/ad/${liveId}`);
    assert.equal(first.status, 302);
    const to = new URL(first.headers.get('location')!);
    assert.equal(to.host, 'example.com');
    assert.equal(to.searchParams.get('x'), '1');
    assert.equal(to.searchParams.get('utm_source'), 'batoma');
    assert.equal(to.searchParams.get('utm_campaign'), 'web-deals');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal((await get(`/go/ad/${liveId}`)).status, 302);
    assert.equal(await count(), before + 1, 'the second click in the same visit is not counted');
    // Another browser is another visit.
    await get(`/go/ad/${liveId}`, { headers: { 'user-agent': `${UA} other` } });
    assert.equal(await count(), before + 2);
  });

  test('impressions are recorded on every serve, from the cache too; bots are not counted', async () => {
    const count = () => owner.siteEvent.count({ where: { type: 'IMPRESSION', adId: liveId } });
    const before = await count();
    await get('/deals');
    await get('/deals');
    await get('/deals', { headers: { 'user-agent': 'Googlebot/2.1' } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await count(), before + 2);
  });

  test('/go/<partner> sends a click on to the map, once per visit', async () => {
    const p = await owner.business.findFirstOrThrow({ where: { isActive: true, verifiedAt: { not: null }, latitude: { not: null } }, select: { slug: true } });
    const target = `partner:${p.slug}:map`;
    made.targets.push(target);
    const count = () => owner.siteEvent.count({ where: { type: 'CLICK', target } });
    const before = await count();
    const r = await get(`/go/${p.slug}?to=map`);
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location')!, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    await get(`/go/${p.slug}?to=map`);
    assert.equal(await count(), before + 1);
  });

  test('an unknown /go link goes home and records nothing', async () => {
    const r = await get('/go/ad/00000000-0000-0000-0000-000000000000');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/');
  });
});

describe('forms', () => {
  before(() => resetLimits());

  test('a bot that fills the hidden field is told it worked, and nothing is sent', async () => {
    const r = await get('/contact', form({ name: 'Bot', contact: 'bot@example.com', message: 'Buy now', website: 'http://spam.example', t: formToken(Date.now() - 10_000) }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/contact?sent=1');
  });

  test('a form sent back in under three seconds is treated as a bot', async () => {
    const r = await get('/contact', form({ name: 'Fast', contact: 'f@example.com', message: 'Hello there', t: formToken() }));
    assert.equal(r.status, 303);
  });

  test('a stale or missing token asks the person to send again, keeping what they typed', async () => {
    const r = await get('/contact', form({ name: 'Sita', contact: 'sita@example.com', message: 'A question about Bandipur' }));
    assert.equal(r.status, 400);
    const body = await r.text();
    assert.match(body, /class="form-error"/);
    assert.ok(body.includes('value="Sita"'));
    assert.ok(body.includes('A question about Bandipur</textarea>'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('the page is served with a fresh time token each time', async () => {
    const a = (await text('/contact')).body.match(/name="t" value="([^"]+)"/)?.[1];
    await new Promise((r) => setTimeout(r, 5));
    const b = (await text('/contact')).body.match(/name="t" value="([^"]+)"/)?.[1];
    assert.ok(a && b && a !== b);
  });

  test('more than ten posts from one address in ten minutes are refused', async () => {
    resetLimits();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await get('/newsletter', form({ email: 'x@example.com', website: 'bot' }))).status;
    assert.equal(last, 429);
    resetLimits();
  });

  test('newsletter links show a button; the GET itself changes nothing', async () => {
    const { status, body, res } = await text('/newsletter/confirm?token=abcdefghijklmnopqrstuvwxyz');
    assert.equal(status, 200);
    assert.match(body, /<form method="post" action="\/newsletter\/confirm"/);
    assert.match(body, /name="robots" content="noindex"/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });
});

describe('printed stickers', () => {
  test('/b/<code> on this domain hands the code to the app, uncached', async () => {
    const r = await get('/b/6KNJ5RAS2T');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `${config.appUrl}/b/6KNJ5RAS2T`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await get('/r/OLDSEAT1')).headers.get('location'), `${config.appUrl}/r/OLDSEAT1`);
    assert.equal((await get('/b/not a code')).status, 404);
  });
});

describe('stories, under their new name', () => {
  test('the old /magazine addresses move to /stories for good, keeping the rest of the address', async () => {
    const art = await owner.article.findFirstOrThrow({ where: { status: 'PUBLISHED', onWebsite: true }, select: { slug: true } });
    for (const [from, to] of [['/magazine', '/stories'], [`/magazine/${art.slug}`, `/stories/${art.slug}`], ['/magazine?page=2', '/stories?page=2']]) {
      const r = await get(from);
      assert.equal(r.status, 301, from);
      assert.equal(new URL(r.headers.get('location') ?? '', base).pathname + new URL(r.headers.get('location') ?? '', base).search, to);
    }
    const { body } = await text('/');
    assert.match(body, /<a href="\/stories"[^>]*>Stories<\/a>/);
    assert.match(body, /<a href="\/events"[^>]*>Events<\/a>/);
    assert.doesNotMatch(body, />Magazine<\/a>/);
  });
});

describe('events', () => {
  const city = `Testpur${Date.now()}`;
  const day = 86_400_000;
  const at = (days: number, hourNpt: number) => {
    const d = new Date(Date.now() + days * day + (5 * 60 + 45) * 60_000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourNpt) - (5 * 60 + 45) * 60_000);
  };
  const ev = async (title: string, data: Record<string, unknown>) => {
    const e = await owner.event.create({ data: { slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, title, summary: `${title}, for the site tests.`, city, startsAt: at(2, 18), ...data } as never });
    made.events.push(e.id);
    return e;
  };

  test('lists what is published or cancelled and still to come; never drafts or finished ones', async () => {
    const live = await ev('Test Live Festival', { status: 'PUBLISHED', endsAt: at(2, 21), venue: 'Lakeside', priceLabel: 'Free' });
    const draft = await ev('Test Draft Fair', { status: 'DRAFT' });
    const past = await ev('Test Past Market', { status: 'PUBLISHED', startsAt: at(-3, 10), endsAt: at(-3, 14) });
    const off = await ev('Test Cancelled Concert', { status: 'CANCELLED', category: 'MUSIC' });
    purge();
    const { body } = await text(`/events?city=${encodeURIComponent(city)}`);
    assert.ok(body.includes(`/events/${live.slug}"`), 'published');
    assert.ok(body.includes(`/events/${off.slug}"`), 'cancelled is listed');
    assert.match(body, /Cancelled<\/span>/);
    assert.ok(!body.includes(draft.slug), 'no draft');
    assert.ok(!body.includes(past.slug), 'nothing finished');
    assert.equal((await get(`/events/${draft.slug}`)).status, 404);
    // Row-level security, not only the query: the read-only role cannot see a draft at all.
    assert.equal(await db.event.findFirst({ where: { id: draft.id }, select: { id: true } }), null);
    assert.ok((await text('/sitemap.xml')).body.includes(`/events/${live.slug}</loc>`));
  });

  test('an event page has its details, the BS date and Event JSON-LD, with no script', async () => {
    const e = await ev('Test Jatra', { status: 'PUBLISHED', category: 'FESTIVAL', endsAt: at(2, 21), venue: 'Durbar Square', address: 'Old town', organiser: 'Town committee', url: 'https://example.com/jatra', priceLabel: 'Free' });
    purge();
    const { status, body } = await text(`/events/${e.slug}`);
    assert.equal(status, 200);
    assert.ok(body.includes('Durbar Square, Old town, ' + city));
    assert.match(body, /\d{1,2} [A-Z][a-z]+ 20[89]\d/, 'a BS date');
    const ld = JSON.parse(body.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]);
    assert.equal(ld['@type'], 'Event');
    assert.equal(ld.eventStatus, 'https://schema.org/EventScheduled');
    assert.match(ld.startDate, /T18:00:00\+05:45$/);
    assert.equal(ld.location.address.addressLocality, city);
    assert.equal(ld.isAccessibleForFree, true);
    assert.ok(body.includes(`href="/events/${e.slug}/calendar.ics"`));
    assert.match(body, /href="https:\/\/example\.com\/jatra" rel="nofollow noopener external"/);
    const ics = await get(`/events/${e.slug}/calendar.ics`);
    assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
    const cal = await ics.text();
    assert.match(cal, /^BEGIN:VCALENDAR\r\n/);
    assert.match(cal, /SUMMARY:Test Jatra\r\n/);
    assert.match(cal, /LOCATION:Durbar Square\\, Old town\\, /);
  });
});

describe('write a trip, and advertise', () => {
  test('Write a trip has its own form: name, email, title, place, story and a promise it is theirs', async () => {
    const { body } = await text('/write');
    assert.match(body, /<form class="form" method="post" action="\/write#h-send">/);
    for (const name of ['name', 'email', 'title', 'place', 'story', 'ownWork', 'website', 't']) assert.match(body, new RegExp(`name="${name}"`), name);
    assert.match(body, /<textarea[^>]*name="story"[^>]*maxlength="20000"/);
    assert.ok(!body.includes('#write"'), 'no longer sends people to the app to write');
  });

  test('a long story in Nepali fits through the form, which other forms would refuse', async () => {
    resetLimits();
    const story = 'हामी बिहानै काठमाडौंबाट बस चढ्यौं। '.repeat(500);
    const r = await get('/write', form({ name: 'Sita', email: 'not-an-email', title: 'Long story', story, ownWork: 'yes', t: formToken(Date.now() - 10_000) }));
    assert.notEqual(r.status, 413, 'not refused for its size');
  });

  test('Advertise shows the vision and mission, not audience figures, and keeps the enquiry form', async () => {
    const { body } = await text('/advertise');
    assert.match(body, /<h2>Our vision<\/h2>/);
    assert.match(body, /<h2>Our mission<\/h2>/);
    assert.match(body, /one platform to explore Nepal/);
    assert.doesNotMatch(body, /class="figures"/);
    assert.match(body, /action="\/advertise#h-ask"/);
  });
});

describe('creators', () => {
  test('only creators an editor put on the website appear; their work shows; nothing private does', async () => {
    const c = await owner.creatorProfile.findFirstOrThrow({ where: { status: 'APPROVED' }, select: { id: true, handle: true, userId: true, showOnWebsite: true } });
    const journey = await owner.creatorJourney.findFirst({ where: { creatorId: c.id, status: 'PUBLISHED' }, select: { id: true, slug: true } });
    const delayed = await owner.post.create({ data: {
      authorId: c.userId, title: `Test delayed post ${Date.now()}`, body: 'Shows tomorrow.', status: 'PUBLISHED', moderation: 'APPROVED',
      publishedAt: new Date(), visibleFrom: new Date(Date.now() + 86_400_000), latitude: 27.7172, longitude: 85.324, locationName: 'Thamel',
    } });
    try {
      await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: false } });
      purge();
      assert.equal((await get(`/creators/${c.handle}`)).status, 404);
      assert.ok(!(await text('/creators')).body.includes(`/creators/${c.handle}"`));
      // Row-level security, not only the query: the role cannot see a creator who is not on the website.
      assert.equal(await db.creatorProfile.findFirst({ where: { id: c.id }, select: { id: true } }), null);

      await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: true } });
      purge();
      const { status, body } = await text(`/creators/${c.handle}`);
      assert.equal(status, 200);
      assert.ok((await text('/creators')).body.includes(`/creators/${c.handle}"`));
      const ld = JSON.parse(body.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)![1]);
      assert.equal(ld['@type'], 'ProfilePage');
      assert.equal(ld.mainEntity['@type'], 'Person');
      assert.ok(!body.includes(delayed.title), 'a post inside its safety delay is not shown');
      assert.doesNotMatch(body, /27\.7172|85\.324|latitude|longitude/, 'no coordinates anywhere');
      // The role is not even allowed to read them.
      await assert.rejects(db.$queryRaw`SELECT latitude FROM posts LIMIT 1`);
      await assert.rejects(db.$queryRaw`SELECT "followerId" FROM follows LIMIT 1`);
      if (journey) {
        assert.ok(body.includes(`/creators/${c.handle}/${journey.slug}`));
        await owner.creatorJourney.update({ where: { id: journey.id }, data: { onWebsite: false } });
        purge();
        assert.equal((await get(`/creators/${c.handle}/${journey.slug}`)).status, 404, 'a journey hidden by an editor');
        await owner.creatorJourney.update({ where: { id: journey.id }, data: { onWebsite: true } });
        purge();
        const page = await text(`/creators/${c.handle}/${journey.slug}`);
        assert.equal(page.status, 200);
        assert.match(page.body, /"@type":"Article"/);
      }
    } finally {
      await owner.post.delete({ where: { id: delayed.id } });
      await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: c.showOnWebsite } });
      purge();
    }
  });

  test('Sign in goes to the app, landing creators on their panel; Become a creator opens on Create an account', async () => {
    const { body } = await text('/');
    assert.ok(body.includes(`href="${config.appUrl}/login.html?returnTo=creator.html%3Fpanel%3D1"`), 'header sign-in');
    assert.match(body, /<a href="\/creators"[^>]*>Creators<\/a>/);
    const join = await text('/creators/join');
    assert.equal(join.status, 200);
    assert.ok(join.body.includes(`href="${config.appUrl}/login.html?mode=register&amp;returnTo=creator.html%3Fpanel%3D1"`));
    assert.match(join.body, /Read on the road you wrote about/);
  });

  test('a story by a creator on the website links its byline to their page', async () => {
    const c = await owner.creatorProfile.findFirstOrThrow({ where: { status: 'APPROVED' }, select: { id: true, handle: true, userId: true, showOnWebsite: true } });
    const art = await owner.article.findFirst({ where: { authorId: c.userId, status: 'PUBLISHED', onWebsite: true }, select: { slug: true } });
    if (!art) return;
    await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: true } });
    try {
      purge();
      assert.match((await text(`/stories/${art.slug}`)).body, new RegExp(`By <a href="/creators/${c.handle}">`));
      await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: false } });
      purge();
      assert.doesNotMatch((await text(`/stories/${art.slug}`)).body, /href="\/creators\//, 'no link to a page that is not there');
    } finally {
      await owner.creatorProfile.update({ where: { id: c.id }, data: { showOnWebsite: c.showOnWebsite } });
      purge();
    }
  });
});

describe('cache purge', () => {
  test('two changes a moment apart both reach the website; an older signed request does nothing', async () => {
    const sign = (at: string) => createHmac('sha256', config.apiKey).update(`purge\n${at}`).digest('hex');
    const purgeAt = (at: string) => get('/_purge', { method: 'POST', headers: { 'x-purge-at': at, 'x-purge-signature': sign(at) } });
    const first = String(Date.now());
    assert.equal((await purgeAt(first)).status, 204);
    await text('/');
    assert.ok(cacheSize() > 0);
    const second = String(Number(first) + 1);
    assert.equal((await purgeAt(second)).status, 204);
    assert.equal(cacheSize(), 0, 'the second purge, a millisecond later, emptied the cache too');
    await text('/');
    await purgeAt(first);
    assert.ok(cacheSize() > 0, 'a replay of the earlier request left the cache alone');
  });

  test('refuses an unsigned or old request and accepts a signed one', async () => {
    assert.equal((await get('/_purge', { method: 'POST' })).status, 403);
    const sign = (at: string) => createHmac('sha256', config.apiKey).update(`purge\n${at}`).digest('hex');
    const old = String(Date.now() - 10 * 60_000);
    assert.equal((await get('/_purge', { method: 'POST', headers: { 'x-purge-at': old, 'x-purge-signature': sign(old) } })).status, 403);
    const now = String(Date.now());
    assert.equal((await get('/_purge', { method: 'POST', headers: { 'x-purge-at': now, 'x-purge-signature': sign(now).replace(/.$/, (c) => (c === '0' ? '1' : '0')) } })).status, 403);
    assert.equal((await get('/_purge', { method: 'POST', headers: { 'x-purge-at': now, 'x-purge-signature': sign(now) } })).status, 204);
  });
});
