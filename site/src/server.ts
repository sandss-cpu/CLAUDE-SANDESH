import { createHmac, timingSafeEqual } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import { join } from 'path';
import { cached, purge } from './cache';
import { checkConfig, config } from './config';
import * as data from './data';
import { db } from './db';
import { record } from './events';
import { checkGuards, formToken, forward, overLimit, pick } from './forms';
import { esc } from './html';
import { icsFile } from './ics';
import * as info from './pages/info';
import { creatorPage, creatorsPage, joinPage, journeyPage } from './pages/creators';
import { event, events } from './pages/events';
import { home } from './pages/home';
import { article, magazine } from './pages/magazine';
import { deals, offer, partner, partners } from './pages/partners';
import { place, trip, trips } from './pages/trips';
import { mediaOrigin, Rendered } from './parts';

/**
 * Batoma's public website. Every page is plain HTML drawn on the server from the
 * read-only database role; there is no script on any page. Rendered pages are kept in
 * memory for PAGE_TTL seconds and dropped when the API signals a change (/_purge).
 */

const PUBLIC = join(__dirname, '../../public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.production ? 1 : false);
  app.set('query parser', 'simple');

  // ---------- headers on everything ----------
  const csp = [
    "default-src 'self'",
    `img-src 'self' data: https:${mediaOrigin && !mediaOrigin.startsWith('https:') ? ` ${mediaOrigin}` : ''}`,
    `media-src 'self' https:${mediaOrigin && !mediaOrigin.startsWith('https:') ? ` ${mediaOrigin}` : ''}`,
    "style-src 'self'", "font-src 'self'", "script-src 'none'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
    ...(config.production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...(config.production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    });
    next();
  });

  // ---------- static files ----------
  const year = 365 * 86400;
  app.use('/fonts', express.static(join(PUBLIC, 'fonts'), { maxAge: year * 1000, immutable: true, index: false }));
  app.use('/css', express.static(join(PUBLIC, 'css'), {
    index: false,
    // site.css is linked with ?v=<hash of its content>, so it can be kept for good.
    setHeaders: (res, file) => res.set('Cache-Control', file.endsWith('site.css') ? `public, max-age=${year}, immutable` : 'public, max-age=86400'),
  }));
  app.use('/icons', express.static(join(PUBLIC, 'icons'), { maxAge: 7 * 86400 * 1000, index: false }));
  app.get('/favicon.ico', (_req, res) => res.redirect(301, '/icons/icon-192.png'));

  // Forms are short, except a story sent from /write: up to 20,000 characters, which in
  // Devanagari is nine bytes a letter once a browser has encoded it.
  const shortForms = express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 20 });
  const storyForm = express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 20 });
  app.use((req, res, next) => (req.method === 'POST' && req.path === '/write' ? storyForm : shortForms)(req, res, next));

  // ---------- serving a page ----------
  async function serve(req: Request, res: Response, key: string, make: () => Promise<Rendered | null>, opts: { fresh?: boolean } = {}) {
    const out = opts.fresh ? await make() : await cached(`page:${key}`, config.pageTtl, make);
    const r = out ?? info.notFound();
    // Counted on every serve, from the cache too: the partner report depends on it.
    void record(req, r.events);
    res.status(r.status ?? 200).type('html');
    const noStore = opts.fresh || (r.status ?? 200) >= 400;
    // private: a shared cache in front would hide views from the counts partners are sold.
    res.set('Cache-Control', noStore ? 'no-store' : `private, max-age=60, stale-while-revalidate=${config.pageTtl}`);
    res.send(r.html.replaceAll('__FORM_TOKEN__', formToken()));
  }
  const page = (n: unknown) => Math.max(1, Math.min(500, parseInt(String(n ?? '1'), 10) || 1));
  const slugOk = (s: string) => /^[a-z0-9][a-z0-9-]{0,119}$/.test(s);

  app.get('/', (req, res) => serve(req, res, 'home', home));
  // The section was called Magazine until October 2026; its old addresses move here for good.
  app.use('/magazine', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.redirect(301, req.originalUrl.replace(/^\/magazine(?=\/|\?|$)/, '/stories'));
  });
  app.get('/stories', (req, res) => { const p = page(req.query.page); return serve(req, res, `mag:${p}`, () => magazine({ page: p })); });
  app.get('/stories/section/:slug', (req, res) => {
    const p = page(req.query.page); const s = req.params.slug;
    return slugOk(s) ? serve(req, res, `sec:${s}:${p}`, () => magazine({ page: p, section: s })) : serve(req, res, '404', async () => null);
  });
  app.get('/stories/issue/:n', (req, res) => {
    const n = parseInt(req.params.n, 10); const p = page(req.query.page);
    return n > 0 ? serve(req, res, `iss:${n}:${p}`, () => magazine({ page: p, issue: n })) : serve(req, res, '404', async () => null);
  });
  app.get('/stories/:slug', (req, res) => slugOk(req.params.slug) ? serve(req, res, `art:${req.params.slug}`, () => article(req.params.slug)) : serve(req, res, '404', async () => null));
  app.get('/trips', (req, res) => serve(req, res, 'trips', trips));
  app.get('/trips/:slug', (req, res) => {
    const back = req.query.dir === 'back';
    return slugOk(req.params.slug) ? serve(req, res, `trip:${req.params.slug}:${back}`, () => trip(req.params.slug, back)) : serve(req, res, '404', async () => null);
  });
  app.get('/places', (_req, res) => res.redirect(301, '/trips#places'));
  app.get('/places/:slug', (req, res) => slugOk(req.params.slug) ? serve(req, res, `place:${req.params.slug}`, () => place(req.params.slug)) : serve(req, res, '404', async () => null));
  app.get('/partners', (req, res) => {
    const f = { place: typeof req.query.place === 'string' ? req.query.place.slice(0, 120) : undefined, type: typeof req.query.type === 'string' ? req.query.type.slice(0, 40) : undefined };
    return serve(req, res, `partners:${f.place ?? ''}:${f.type ?? ''}`, () => partners(f));
  });
  app.get('/partners/:slug', (req, res) => {
    const sent = req.query.sent === '1';
    return slugOk(req.params.slug) ? serve(req, res, `partner:${req.params.slug}:${sent}`, () => partner(req.params.slug, { sent })) : serve(req, res, '404', async () => null);
  });
  app.get('/deals', (req, res) => serve(req, res, 'deals', deals));
  app.get('/offers/:id', (req, res) => /^[0-9a-f-]{36}$/.test(req.params.id) ? serve(req, res, `offer:${req.params.id}`, () => offer(req.params.id)) : serve(req, res, '404', async () => null));
  app.get('/write', (req, res) => { const sent = req.query.sent === '1'; return serve(req, res, `write:${sent}`, async () => info.write({ sent })); });
  // Creators an editor has put on the website. Handles are 3–24 of a-z, 0-9 and _.
  const handleOk = (s: string) => /^[a-z0-9_]{3,24}$/.test(s);
  app.get('/creators', (req, res) => serve(req, res, 'creators', creatorsPage));
  app.get('/creators/join', (req, res) => serve(req, res, 'creators:join', async () => joinPage()));
  app.get('/creators/:handle', (req, res) => handleOk(req.params.handle)
    ? serve(req, res, `creator:${req.params.handle}`, () => creatorPage(req.params.handle)) : serve(req, res, '404', async () => null));
  app.get('/creators/:handle/:slug', (req, res) => handleOk(req.params.handle) && slugOk(req.params.slug)
    ? serve(req, res, `journey:${req.params.handle}:${req.params.slug}`, () => journeyPage(req.params.handle, req.params.slug))
    : serve(req, res, '404', async () => null));
  app.get('/events', (req, res) => {
    const city = String(req.query.city ?? '').slice(0, 60);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) ? String(req.query.month) : '';
    return serve(req, res, `events:${city.toLowerCase()}:${month}`, () => events({ city: city || undefined, month: month || undefined }));
  });
  app.get('/events/:slug', (req, res) => slugOk(req.params.slug) ? serve(req, res, `event:${req.params.slug}`, () => event(req.params.slug)) : serve(req, res, '404', async () => null));
  app.get('/events/:slug/calendar.ics', async (req, res) => {
    const e = slugOk(req.params.slug) ? await data.event(req.params.slug) : null;
    if (!e) return serve(req, res, '404', async () => null);
    const url = `${config.siteUrl}/events/${e.slug}`;
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${e.slug}.ics"`, 'Cache-Control': 'private, max-age=300' });
    res.send(icsFile({ ...e, url, cancelled: e.status === 'CANCELLED' }, new URL(config.siteUrl).hostname));
  });
  app.get('/about', (req, res) => serve(req, res, 'about', async () => info.about()));
  app.get('/privacy', (req, res) => serve(req, res, 'privacy', async () => info.privacy()));
  app.get('/terms', (req, res) => serve(req, res, 'terms', async () => info.terms()));
  app.get('/contact', (req, res) => { const sent = req.query.sent === '1'; return serve(req, res, `contact:${sent}`, async () => info.contact({ sent })); });
  app.get('/advertise', (req, res) => { const sent = req.query.sent === '1'; return serve(req, res, `advertise:${sent}`, async () => info.advertise({ sent })); });
  app.get('/newsletter', (req, res) => { const sent = req.query.sent === '1'; return serve(req, res, `newsletter:${sent}`, async () => info.newsletterPage({ sent })); });

  // ---------- forms: guard, forward, then post/redirect/get ----------
  type FormPage = (state: { values?: Record<string, string>; error?: string }) => Promise<Rendered | null> | Rendered | null;
  async function handleForm(req: Request, res: Response, o: {
    fields: string[]; longer?: Record<string, number>; done: string; render: FormPage;
    send: (v: Record<string, string>) => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }>;
    /** A page to show at once instead of redirecting, such as the development link for a story. */
    shown?: (data: Record<string, unknown> | undefined) => Rendered | null;
  }) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const values = pick(body, o.fields, o.longer);
    const again = (error: string, status: number) => serve(req, res, '', async () => {
      const r = await o.render({ values, error });
      return r ? { ...r, status } : null;
    }, { fresh: true });
    if (overLimit(req)) return again('Too many messages from your connection. Please try again in a few minutes.', 429);
    const guard = checkGuards(body);
    // A bot is told it worked and nothing is sent.
    if (guard === 'bot') return res.redirect(303, o.done);
    if (guard === 'stale') return again('This form had been open too long. Please send it again.', 400);
    const r = await o.send(values);
    if (!r.ok) return again(r.message ?? 'Please check the form and try again.', 400);
    const now = o.shown?.(r.data);
    return now ? serve(req, res, '', async () => now, { fresh: true }) : res.redirect(303, o.done);
  }

  app.post('/contact', (req, res) => handleForm(req, res, {
    fields: ['name', 'contact', 'message'], done: '/contact?sent=1', render: (s) => info.contact(s),
    send: (v) => forward('/site/enquiries', { kind: 'CONTACT', ...v }, req),
  }));
  app.post('/advertise', (req, res) => handleForm(req, res, {
    fields: ['name', 'organisation', 'contact', 'message'], done: '/advertise?sent=1#h-ask', render: (s) => info.advertise(s),
    send: (v) => forward('/site/enquiries', { kind: 'ADVERTISE', ...v, organisation: v.organisation || undefined }, req),
  }));
  app.post('/write', (req, res) => handleForm(req, res, {
    fields: ['name', 'email', 'title', 'place', 'story', 'ownWork'], longer: { story: 20000 }, done: '/write?sent=1#h-send',
    render: (s) => info.write(s),
    send: (v) => forward('/site/stories', {
      name: v.name, email: v.email, title: v.title, place: v.place || undefined, story: v.story, ownWork: v.ownWork === 'yes',
    }, req),
    shown: (d) => (typeof d?.devLink === 'string' ? info.write({ sent: true, devLink: d.devLink }) : null),
  }));
  app.post('/newsletter', (req, res) => handleForm(req, res, {
    fields: ['email', 'source'], done: '/newsletter?sent=1', render: (s) => info.newsletterPage(s),
    send: (v) => forward('/site/newsletter', { email: v.email, source: v.source.slice(0, 60) || undefined }, req),
  }));
  app.post('/partners/:slug/enquire', (req, res) => {
    const slug = req.params.slug;
    if (!slugOk(slug)) return serve(req, res, '404', async () => null);
    return handleForm(req, res, {
      fields: ['name', 'contact', 'message'], done: `/partners/${slug}?sent=1#enquire`, render: (s) => partner(slug, s),
      send: (v) => forward('/site/leads', { businessSlug: slug, ...v }, req),
    });
  });

  // A story's email link: the page shows a button; only the POST sends the story on.
  app.get('/write/confirm', (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    const token = String(req.query.token ?? '').slice(0, 128);
    return serve(req, res, '', async () => info.storyConfirmPage(token), { fresh: true });
  });
  app.post('/write/confirm', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    const token = String((req.body as Record<string, unknown>)?.token ?? '').slice(0, 128);
    if (overLimit(req)) return serve(req, res, '', async () => ({ ...info.storyConfirmPage(token, { ok: false, message: 'Too many tries from your connection. Please wait a few minutes.' }), status: 429 }), { fresh: true });
    const r = await forward('/site/stories/confirm', { token }, req);
    return serve(req, res, '', async () => ({
      ...info.storyConfirmPage(token, r.ok
        ? { ok: true, title: r.data?.title as string | undefined, needsPassword: r.data?.needsPassword === true, devPasswordLink: r.data?.devPasswordLink as string | undefined }
        : { ok: false, message: r.message }),
      status: r.ok ? 200 : 400,
    }), { fresh: true });
  });

  // Newsletter links: the page shows a button; only the POST acts.
  for (const kind of ['confirm', 'unsubscribe'] as const) {
    app.get(`/newsletter/${kind}`, (req, res) => {
      res.set('Referrer-Policy', 'no-referrer');
      const token = String(req.query.token ?? '').slice(0, 128);
      return serve(req, res, '', async () => info.tokenPage(kind, token), { fresh: true });
    });
    app.post(`/newsletter/${kind}`, async (req, res) => {
      res.set('Referrer-Policy', 'no-referrer');
      const token = String((req.body as Record<string, unknown>)?.token ?? '').slice(0, 128);
      if (overLimit(req)) return serve(req, res, '', async () => ({ ...info.tokenPage(kind, token, { ok: false }), status: 429 }), { fresh: true });
      const r = await forward(`/site/newsletter/${kind}`, { token }, req);
      return serve(req, res, '', async () => info.tokenPage(kind, token, { ok: r.ok, unsubscribeToken: r.data?.unsubscribeToken as string | undefined }), { fresh: true });
    });
  }

  // ---------- counted links out ----------
  const withUtm = (url: string, campaign: string) => {
    try {
      const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.searchParams.set('utm_source', 'batoma');
      u.searchParams.set('utm_medium', 'referral');
      u.searchParams.set('utm_campaign', campaign);
      return u.toString();
    } catch { return null; }
  };
  const away = (res: Response, to: string) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    return res.redirect(302, to);
  };

  /** Clicks are counted, so they are limited: 60 a minute per address, then they still go through, uncounted. */
  const goHits = new Map<string, { n: number; since: number }>();
  const countable = (req: Request) => {
    const key = req.ip ?? '';
    const now = Date.now();
    const h = goHits.get(key);
    if (!h || now - h.since > 60_000) {
      goHits.set(key, { n: 1, since: now });
      if (goHits.size > 10_000) for (const [k, v] of goHits) if (now - v.since > 60_000) goHits.delete(k);
      return true;
    }
    return ++h.n <= 60;
  };

  app.get('/go/ad/:id', async (req, res) => {
    const ad = /^[0-9a-f-]{36}$/.test(req.params.id) ? await data.offer(req.params.id) : null;
    if (!ad) return away(res, '/');
    const to = ad.linkType === 'EXTERNAL' && ad.externalUrl ? withUtm(ad.externalUrl, ad.placement.toLowerCase().replace(/_/g, '-')) : null;
    // One click per visit: a repeat in the same half-hour is dropped by the database.
    if (countable(req)) await record(req, [{ type: 'CLICK', path: req.path, target: `ad:${ad.id}`, adId: ad.id, businessId: ad.businessId }]);
    return away(res, to ?? `/offers/${ad.id}`);
  });

  app.get('/go/:slug', async (req, res) => {
    const p = slugOk(req.params.slug) ? await data.partnerLink(req.params.slug) : null;
    if (!p) return away(res, '/partners');
    const want = String(req.query.to ?? 'website');
    let to: string | null = null;
    if (want === 'whatsapp' && p.whatsapp) {
      const n = p.whatsapp.replace(/\D/g, '');
      to = n.length >= 7 ? `https://wa.me/${n.length === 10 && n.startsWith('9') ? `977${n}` : n}` : null;
    } else if (want === 'map' && p.latitude != null && p.longitude != null) {
      to = `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`;
    } else if (want === 'website' && p.website) {
      to = withUtm(p.website, 'partner-listing');
    }
    if (!to) return away(res, `/partners/${p.slug}`);
    const kind = want === 'whatsapp' || want === 'map' ? want : 'website';
    if (countable(req)) await record(req, [{ type: 'CLICK', path: req.path, target: `partner:${p.slug}:${kind}`, businessId: p.id }]);
    return away(res, to);
  });

  // ---------- printed stickers ----------
  // A sticker carries https://<this domain>/b/<code> for ever; the reader lives on the app's
  // domain. 302, not 301: browsers keep a 301 for good, and the app's address may change.
  app.get(['/b/:code', '/r/:code'], (req, res) => {
    const code = String(req.params.code);
    if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) return serve(req, res, '404', async () => null);
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return res.redirect(302, `${config.appUrl}${req.path.startsWith('/r/') ? '/r/' : '/b/'}${encodeURIComponent(code)}`);
  });

  // ---------- for search engines ----------
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=86400')
      .send(`User-agent: *\nDisallow: /go/\nDisallow: /newsletter/\nDisallow: /offers/\nDisallow: /write/confirm\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', async (_req, res) => {
    const xml = await cached('sitemap', 3600, async () => {
      const fixed = ['/', '/stories', '/trips', '/events', '/creators', '/creators/join', '/partners', '/deals', '/write', '/advertise', '/about', '/contact', '/newsletter'];
      const rows = [...fixed.map((path) => ({ path, lastmod: null as Date | null })), ...(await data.sitemapEntries())];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map((r) =>
        `<url><loc>${esc(`${config.siteUrl}${r.path}`)}</loc>${r.lastmod ? `<lastmod>${r.lastmod.toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
    });
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
  });

  // ---------- operations ----------
  app.get('/healthz', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.set('Cache-Control', 'no-store').json({ ok: true });
    } catch {
      res.status(503).set('Cache-Control', 'no-store').json({ ok: false });
    }
  });

  /** The API drops the page cache when something shown here changes. Signed with SITE_API_KEY, valid for five minutes. */
  let lastPurge = 0;
  app.post('/_purge', (req, res) => {
    const at = String(req.get('x-purge-at') ?? '');
    const given = Buffer.from(String(req.get('x-purge-signature') ?? ''));
    const expected = Buffer.from(createHmac('sha256', config.apiKey || 'unset').update(`purge\n${at}`).digest('hex'));
    const fresh = Math.abs(Date.now() - Number(at)) < 5 * 60_000;
    if (!config.apiKey || !fresh || given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(403).end();
    // Every change purges, however quickly they follow each other (an event added, then
    // published a moment later). A replayed request older than the last one does nothing.
    if (Number(at) >= lastPurge) { purge(); lastPurge = Number(at); console.log('page cache purged by the API'); }
    return res.status(204).end();
  });

  app.use((req, res) => serve(req, res, '404', async () => null));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error(`${req.method} ${req.path}:`, err.message);
    if (res.headersSent) return;
    const r = info.serverError();
    res.status(500).type('html').set('Cache-Control', 'no-store').send(r.html);
  });
  return app;
}

if (require.main === module) {
  checkConfig();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`Batoma site on ${config.siteUrl} (port ${config.port})`));
  const stop = () => { server.close(); void db.$disconnect(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
