/**
 * What a traveller on one bus, going one way, at one moment, is shown.
 *
 * Pure on purpose: the service fetches candidates (already narrowed to this bus's
 * company, route and the placements whose date window covers `at`), and this decides
 * everything else. The admin preview and the reader call the same function, so the
 * preview cannot drift from what a bus actually shows.
 *
 * Levels, most specific first:
 *   VEHICLE → OPERATOR → ROUTE for this direction → ROUTE for both → DEFAULT
 * An article placed at several levels keeps its most specific placement. The list
 * runs level by level, and within a level: the pinned story, then the editor's order,
 * then featured, then newest. So a bus's own programme — and its pinned lead — always
 * comes before its route's, which is what an override is for; removing the bus's
 * placements leaves the route's list exactly as it was.
 */

export type Direction = 'FORWARD' | 'REVERSE';
export type PlacementDirection = Direction | 'BOTH';
export type Scope = 'DEFAULT' | 'ROUTE' | 'OPERATOR' | 'VEHICLE';
export type Level = 'VEHICLE' | 'OPERATOR' | 'ROUTE_DIRECTION' | 'ROUTE_BOTH' | 'DEFAULT';

const LEVEL_RANK: Record<Level, number> = {
  VEHICLE: 0, OPERATOR: 1, ROUTE_DIRECTION: 2, ROUTE_BOTH: 3, DEFAULT: 4,
};

/** A lead story plus this many on the main shelf; the rest go to "More from this issue". */
export const SHELF_SIZE = 12;

export interface ArticleFacts {
  id: string;
  isFeatured: boolean;
  publishedAt: Date | string | null;
}

export interface Candidate<A extends ArticleFacts = ArticleFacts> {
  id: string;
  scope: Scope;
  routeId: string | null;
  operatorId: string | null;
  vehicleId: string | null;
  direction: PlacementDirection;
  position: number;
  isPinned: boolean;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  daysOfWeek: number[];
  timeFrom: string | null;
  timeTo: string | null;
  article: A;
}

export interface Context {
  vehicleId?: string | null;
  operatorId?: string | null;
  routeId?: string | null;
  /** Unknown direction means only content programmed for both directions. */
  direction?: Direction | null;
  at: Date;
}

export interface Placed<A extends ArticleFacts = ArticleFacts> {
  article: A;
  level: Level;
  placementId: string | null;
  isPinned: boolean;
}

export interface Programme<A extends ArticleFacts = ArticleFacts> {
  lead: Placed<A> | null;
  /** Up to SHELF_SIZE after the lead. */
  stories: Placed<A>[];
  /** Everything else, for "More from this issue". */
  more: Placed<A>[];
}

/** Nepal keeps UTC+5:45 all year, so a fixed offset is exact. */
const KATHMANDU_OFFSET_MINUTES = 5 * 60 + 45;

export function kathmanduClock(at: Date) {
  const local = new Date(at.getTime() + KATHMANDU_OFFSET_MINUTES * 60_000);
  return { day: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const time = (value: Date | string | null) => (value == null ? null : new Date(value).getTime());

/**
 * Whether a placement is live at `at`: inside its dates, on one of its days and inside
 * its daily window, all in Asia/Kathmandu. A window whose start is later than its end
 * runs past midnight, and belongs to the day it opened on — so a Friday 22:00–02:00
 * night-bus placement is still on at 01:00 on Saturday.
 */
export function isLive(p: Pick<Candidate, 'startsAt' | 'endsAt' | 'daysOfWeek' | 'timeFrom' | 'timeTo'>, at: Date) {
  const now = at.getTime();
  const starts = time(p.startsAt);
  const ends = time(p.endsAt);
  if (starts != null && now < starts) return false;
  if (ends != null && now >= ends) return false;

  const clock = kathmanduClock(at);
  let day = clock.day;
  if (p.timeFrom && p.timeTo) {
    const from = toMinutes(p.timeFrom);
    const to = toMinutes(p.timeTo);
    if (from < to) {
      if (clock.minutes < from || clock.minutes >= to) return false;
    } else {
      // Past midnight: on from `from` until midnight, and from midnight until `to`.
      if (clock.minutes < from && clock.minutes >= to) return false;
      if (clock.minutes < to) day = (day + 6) % 7;
    }
  }
  return !p.daysOfWeek?.length || p.daysOfWeek.includes(day);
}

/** Which level a placement applies at for this bus and direction, or null if it does not apply. */
export function levelOf(p: Candidate, ctx: Context): Level | null {
  const directionFits = p.direction === 'BOTH' || (!!ctx.direction && p.direction === ctx.direction);
  const routeFits = !p.routeId || p.routeId === ctx.routeId;
  switch (p.scope) {
    case 'VEHICLE':
      return ctx.vehicleId && p.vehicleId === ctx.vehicleId && routeFits && directionFits ? 'VEHICLE' : null;
    case 'OPERATOR':
      return ctx.operatorId && p.operatorId === ctx.operatorId && routeFits && directionFits ? 'OPERATOR' : null;
    case 'ROUTE':
      if (!ctx.routeId || p.routeId !== ctx.routeId) return null;
      if (p.direction === 'BOTH') return 'ROUTE_BOTH';
      return ctx.direction && p.direction === ctx.direction ? 'ROUTE_DIRECTION' : null;
    case 'DEFAULT':
      return 'DEFAULT';
    default:
      return null;
  }
}

/**
 * @param candidates placements for this bus's vehicle, company, route and the DEFAULT list
 * @param fallback   the current issue's articles: the last level, after DEFAULT placements
 */
export function contentFor<A extends ArticleFacts>(
  candidates: Candidate<A>[],
  fallback: A[],
  ctx: Context,
): Programme<A> {
  type Ranked = Placed<A> & { rank: number; position: number };
  const best = new Map<string, Ranked>();

  const consider = (entry: Ranked) => {
    const current = best.get(entry.article.id);
    const better = !current
      || entry.rank < current.rank
      || (entry.rank === current.rank && Number(entry.isPinned) > Number(current.isPinned))
      || (entry.rank === current.rank && entry.isPinned === current.isPinned && entry.position < current.position);
    if (better) best.set(entry.article.id, entry);
  };

  for (const p of candidates) {
    const level = levelOf(p, ctx);
    if (!level || !isLive(p, ctx.at)) continue;
    consider({
      article: p.article, level, placementId: p.id, isPinned: p.isPinned,
      rank: LEVEL_RANK[level], position: p.position,
    });
  }
  // The current issue fills in after everything an editor placed by hand.
  fallback.forEach((article, i) => consider({
    article, level: 'DEFAULT', placementId: null, isPinned: false,
    rank: LEVEL_RANK.DEFAULT, position: Number.MAX_SAFE_INTEGER / 2 + i,
  }));

  const ordered = [...best.values()].sort((a, b) =>
    a.rank - b.rank
    || Number(b.isPinned) - Number(a.isPinned)
    || a.position - b.position
    || Number(b.article.isFeatured) - Number(a.article.isFeatured)
    || (time(b.article.publishedAt) ?? 0) - (time(a.article.publishedAt) ?? 0),
  );

  const placed = ordered.map(({ article, level, placementId, isPinned }) => ({ article, level, placementId, isPinned }));
  return {
    lead: placed[0] ?? null,
    stories: placed.slice(1, 1 + SHELF_SIZE),
    more: placed.slice(1 + SHELF_SIZE),
  };
}
