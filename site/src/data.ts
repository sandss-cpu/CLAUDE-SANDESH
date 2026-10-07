import { AdPlacement, Prisma } from '@prisma/client';
import { db } from './db';

/**
 * What the pages read. Row-level security on the batoma_site role already hides anything
 * unpublished, unverified or switched off; the filters here add dates (an ad or coupon
 * shows only inside its window) and order.
 */

const now = () => new Date();
/** Published, and not taken off the website in the control panel (the app may still show it). */
const LIVE_ARTICLE = { status: 'PUBLISHED', onWebsite: true } satisfies Prisma.ArticleWhereInput;

export const ARTICLE_CARD = {
  id: true, slug: true, title: true, subtitle: true, summary: true, coverImageUrl: true, audioUrl: true, readMinutes: true,
  isSponsored: true, isFeatured: true, publishedAt: true, updatedAt: true,
  category: { select: { slug: true, name: true } },
  sponsor: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.ArticleSelect;
export type ArticleCard = Prisma.ArticleGetPayload<{ select: typeof ARTICLE_CARD }>;

/** Ads live now in one website slot, newest first; section and place sponsors are matched to their target. */
export function liveAds(placement: AdPlacement, opts: { categoryId?: string | null; destinationId?: string | null; take?: number } = {}) {
  return db.advertisement.findMany({
    where: {
      placement, isActive: true, startsAt: { lte: now() }, endsAt: { gt: now() },
      ...(opts.categoryId !== undefined ? { targetCategoryId: opts.categoryId } : {}),
      ...(opts.destinationId !== undefined ? { targetDestinationId: opts.destinationId } : {}),
    },
    orderBy: { startsAt: 'desc' },
    take: opts.take ?? 1,
    select: {
      id: true, title: true, advertiserName: true, tagline: true, imageUrl: true, placement: true, linkType: true, externalUrl: true,
      overviewTitle: true, businessId: true, business: { select: { slug: true, name: true } },
    },
  });
}
export type LiveAd = Awaited<ReturnType<typeof liveAds>>[number];

export function articles(opts: { categoryId?: string; issueId?: string; featured?: boolean; skip?: number; take?: number; notIds?: string[] } = {}) {
  return db.article.findMany({
    where: {
      ...LIVE_ARTICLE,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts.issueId ? { issueId: opts.issueId } : {}),
      ...(opts.featured ? { isFeatured: true } : {}),
      ...(opts.notIds?.length ? { id: { notIn: opts.notIds } } : {}),
    },
    orderBy: [{ publishedAt: 'desc' }, { title: 'asc' }],
    skip: opts.skip ?? 0, take: opts.take ?? 12,
    select: ARTICLE_CARD,
  });
}

export const articleCount = (where: Prisma.ArticleWhereInput = {}) => db.article.count({ where: { ...where, ...LIVE_ARTICLE } });

export function article(slug: string) {
  return db.article.findFirst({
    where: { slug, ...LIVE_ARTICLE },
    select: {
      ...ARTICLE_CARD, body: true, keyPoints: true, categoryId: true,
      author: { select: { name: true } },
      issue: { select: { number: true, title: true } },
      sponsor: { select: { id: true, slug: true, name: true, category: true, district: true } },
      destinations: { select: { destination: { select: { slug: true, name: true } } } },
    },
  });
}

export const categories = () => db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
export const category = (slug: string) => db.category.findUnique({ where: { slug } });
const ISSUE = { id: true, number: true, title: true, titleNe: true, strapline: true, coverImageUrl: true, season: true, publishedAt: true } as const;
export const issues = () => db.issue.findMany({ where: { status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: ISSUE });

export function guides(opts: { kind?: 'ROUTE' | 'DESTINATION'; destinationId?: string; take?: number } = {}) {
  return db.routeGuide.findMany({
    where: { status: 'PUBLISHED', ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.destinationId ? { destinationId: opts.destinationId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }],
    take: opts.take ?? 50,
    select: {
      id: true, slug: true, kind: true, title: true, summary: true, coverImageUrl: true, dayCount: true, direction: true, updatedAt: true,
      route: { select: { name: true, startPlace: true, endPlace: true, distanceKm: true, typicalHours: true } },
      destination: { select: { slug: true, name: true } },
      _count: { select: { stops: true } },
    },
  });
}

export function guide(slug: string) {
  return db.routeGuide.findFirst({
    where: { slug, status: 'PUBLISHED' },
    select: {
      id: true, slug: true, kind: true, title: true, summary: true, coverImageUrl: true, dayCount: true, direction: true, updatedAt: true, publishedAt: true,
      route: { select: { id: true, name: true, startPlace: true, endPlace: true, distanceKm: true, typicalHours: true } },
      destination: { select: { id: true, slug: true, name: true, latitude: true, longitude: true } },
      stops: {
        orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { distanceFromStartKm: 'asc' }],
        select: {
          id: true, kind: true, name: true, description: true, imageUrl: true, latitude: true, longitude: true, dayNumber: true,
          distanceFromStartKm: true, minutesFromStart: true, priceFromNpr: true, openingHours: true, tip: true, isHighlight: true,
          business: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });
}

export const PARTNER_CARD = {
  id: true, slug: true, name: true, category: true, description: true, district: true, priceRange: true, tier: true, verifiedAt: true,
  destination: { select: { slug: true, name: true } },
  photos: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true, caption: true } },
} satisfies Prisma.BusinessSelect;

export function partners(opts: { destinationId?: string; category?: string; take?: number; featuredFirst?: boolean } = {}) {
  return db.business.findMany({
    where: {
      isActive: true, verifiedAt: { not: null },
      ...(opts.destinationId ? { destinationId: opts.destinationId } : {}),
      ...(opts.category ? { category: opts.category as Prisma.BusinessWhereInput['category'] } : {}),
    },
    // Partners who pay for a higher tier come first, as they were sold.
    orderBy: [{ tier: 'desc' }, { name: 'asc' }],
    take: opts.take ?? 60,
    select: PARTNER_CARD,
  });
}

export function partner(slug: string) {
  return db.business.findFirst({
    where: { slug, isActive: true, verifiedAt: { not: null } },
    select: {
      ...PARTNER_CARD, address: true, latitude: true, longitude: true, phone: true, whatsapp: true, viber: true, website: true, amenities: true, updatedAt: true,
      photos: { orderBy: { sortOrder: 'asc' }, take: 8, select: { url: true, caption: true } },
      coupons: { where: { isActive: true, validFrom: { lte: now() }, validTo: { gt: now() } }, orderBy: { validTo: 'asc' }, select: { id: true, title: true, description: true, discountLabel: true, validTo: true } },
    },
  });
}

export function deals(take = 24) {
  return db.coupon.findMany({
    where: { isActive: true, validFrom: { lte: now() }, validTo: { gt: now() } },
    orderBy: { validTo: 'asc' }, take,
    select: { id: true, title: true, description: true, discountLabel: true, validTo: true, business: { select: { id: true, slug: true, name: true, district: true } } },
  });
}

export const destinations = () => db.destination.findMany({ orderBy: { name: 'asc' }, select: { id: true, slug: true, name: true, district: true } });
export const destination = (slug: string) => db.destination.findUnique({ where: { slug } });

export function articlesAbout(destinationId: string, take = 6) {
  return db.article.findMany({
    where: { ...LIVE_ARTICLE, destinations: { some: { destinationId } } },
    orderBy: { publishedAt: 'desc' }, take, select: ARTICLE_CARD,
  });
}

export function offer(id: string) {
  return db.advertisement.findFirst({
    where: { id, isActive: true, startsAt: { lte: now() }, endsAt: { gt: now() } },
    select: { id: true, title: true, advertiserName: true, tagline: true, imageUrl: true, overviewTitle: true, overviewBody: true, overviewImageUrl: true, linkType: true, externalUrl: true, placement: true, businessId: true, business: { select: { slug: true, name: true } } },
  });
}

/** Just enough of a partner to send a click on: /go/<slug>. */
export const partnerLink = (slug: string) => db.business.findFirst({
  where: { slug, isActive: true, verifiedAt: { not: null } },
  select: { id: true, slug: true, website: true, whatsapp: true, latitude: true, longitude: true },
});

// ================= events =================

const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;
/** Midnight in Kathmandu at the start of the day `d` falls on there (or of month `ym`). */
const nptMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - NPT_OFFSET_MS);
const todayNpt = () => { const l = new Date(Date.now() + NPT_OFFSET_MS); return nptMidnight(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()); };
/** Not over yet: one that ends (or, with no end, starts) any time today is still listed. */
const stillOn = (): Prisma.EventWhereInput => ({ OR: [{ endsAt: { gte: todayNpt() } }, { endsAt: null, startsAt: { gte: todayNpt() } }] });

export const EVENT_CARD = {
  id: true, slug: true, title: true, summary: true, category: true, city: true, venue: true, startsAt: true, endsAt: true,
  allDay: true, priceLabel: true, imageUrl: true, status: true, isFeatured: true,
} satisfies Prisma.EventSelect;
export type EventCard = Prisma.EventGetPayload<{ select: typeof EVENT_CARD }>;

/** Events still to come (row-level security already leaves out drafts), soonest first. */
export function events(opts: { city?: string; month?: string; take?: number; notId?: string } = {}) {
  const and: Prisma.EventWhereInput[] = [stillOn()];
  if (opts.city) and.push({ city: { equals: opts.city, mode: 'insensitive' } });
  const m = /^(\d{4})-(\d{2})$/.exec(opts.month ?? '');
  if (m) {
    // Anything on during that month in Kathmandu: it starts before the month ends and ends (or starts) after it begins.
    const from = nptMidnight(Number(m[1]), Number(m[2]) - 1, 1);
    const to = nptMidnight(Number(m[1]), Number(m[2]), 1);
    and.push({ startsAt: { lt: to } }, { OR: [{ endsAt: { gte: from } }, { endsAt: null, startsAt: { gte: from } }] });
  }
  if (opts.notId) and.push({ id: { not: opts.notId } });
  return db.event.findMany({ where: { AND: and }, orderBy: [{ startsAt: 'asc' }, { title: 'asc' }], take: opts.take ?? 200, select: EVENT_CARD });
}

/** The towns and cities with something coming up, for the filter. */
export async function eventCities() {
  const rows = await db.event.findMany({ where: stillOn(), distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } });
  return rows.map((r) => r.city);
}

export function event(slug: string) {
  return db.event.findFirst({
    where: { slug },
    select: {
      ...EVENT_CARD, titleNe: true, description: true, address: true, organiser: true, url: true, publishedAt: true, updatedAt: true,
      destination: { select: { slug: true, name: true } },
    },
  });
}

/** Everything the sitemap lists, with when it last changed. */
export async function sitemapEntries() {
  const [arts, gds, biz, dests, cats, iss, evs] = await Promise.all([
    db.article.findMany({ where: LIVE_ARTICLE, select: { slug: true, updatedAt: true } }),
    db.routeGuide.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
    db.business.findMany({ where: { isActive: true, verifiedAt: { not: null } }, select: { slug: true, updatedAt: true } }),
    db.destination.findMany({ select: { slug: true } }),
    db.category.findMany({ select: { slug: true } }),
    db.issue.findMany({ where: { status: 'PUBLISHED' }, select: { number: true, publishedAt: true } }),
    db.event.findMany({ where: stillOn(), select: { slug: true, updatedAt: true } }),
  ]);
  return [
    ...arts.map((a) => ({ path: `/stories/${a.slug}`, lastmod: a.updatedAt })),
    ...gds.map((g) => ({ path: `/trips/${g.slug}`, lastmod: g.updatedAt })),
    ...biz.map((b) => ({ path: `/partners/${b.slug}`, lastmod: b.updatedAt })),
    ...dests.map((d) => ({ path: `/places/${d.slug}`, lastmod: null })),
    ...cats.map((c) => ({ path: `/stories/section/${c.slug}`, lastmod: null })),
    ...iss.map((i) => ({ path: `/stories/issue/${i.number}`, lastmod: i.publishedAt })),
    ...evs.map((e) => ({ path: `/events/${e.slug}`, lastmod: e.updatedAt })),
  ];
}
