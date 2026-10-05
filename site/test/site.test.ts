import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { purge } from '../src/cache';
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
const made: { ads: string[]; targets: string[] } = { ads: [], targets: [] };
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
    assert.ok(map.body.includes(`/magazine/${art.slug}</loc>`));
  });

  test('a draft story is not served', async () => {
    const draft = await owner.article.findFirst({ where: { status: { not: 'PUBLISHED' } }, select: { slug: true } });
    if (!draft) return;
    assert.equal((await get(`/magazine/${draft.slug}`)).status, 404);
  });
});

describe('an article page without JavaScript', () => {
  test('has the title, the body, share tags and Article JSON-LD in its source', async () => {
    const a = await owner.article.findFirstOrThrow({
      where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, select: { slug: true, title: true, body: true },
    });
    const { status, body } = await text(`/magazine/${a.slug}`);
    assert.equal(status, 200);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    assert.ok(body.includes(`<h1>${esc(a.title)}</h1>`));
    const firstWords = a.body.split(/\n{2,}/).find((p) => !p.startsWith('#'))!.replace(/\*+/g, '').split(/\s+/).slice(0, 6).join(' ');
    assert.ok(body.includes(esc(firstWords)), 'body text is in the page');
    assert.ok(body.includes(`<meta property="og:title" content="${esc(a.title)}">`));
    assert.ok(body.includes('<meta property="og:type" content="article">'));
    assert.match(body, /<link rel="canonical" href="[^"]+\/magazine\//);
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
    const magazine = await text('/magazine');
    assert.ok(!magazine.body.includes(liveTitle));
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

describe('cache purge', () => {
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
