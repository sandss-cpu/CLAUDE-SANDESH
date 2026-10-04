import { Candidate, contentFor, isLive, kathmanduClock, levelOf, SHELF_SIZE } from './content-for';

const ROUTE = 'route-ktm-pkr';
const OTHER_ROUTE = 'route-ktm-ctn';
const COMPANY = 'company-ganapati';
const BUS = 'bus-ba2kha';

const article = (id: string, extra: Partial<{ isFeatured: boolean; publishedAt: string }> = {}) => ({
  id, isFeatured: false, publishedAt: '2026-09-01T00:00:00Z', ...extra,
});

let seq = 0;
function placement(articleId: string, over: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    id: `p${seq}`, scope: 'ROUTE', routeId: ROUTE, operatorId: null, vehicleId: null,
    direction: 'BOTH', position: 0, isPinned: false, startsAt: null, endsAt: null,
    daysOfWeek: [], timeFrom: null, timeTo: null, article: article(articleId), ...over,
  };
}

/** 10:00 on Saturday 3 October 2026 in Kathmandu (04:15 UTC). */
const SAT_10AM = new Date('2026-10-03T04:15:00Z');
const ids = (p: ReturnType<typeof contentFor>) =>
  [p.lead, ...p.stories, ...p.more].filter(Boolean).map((x) => x!.article.id);

describe('kathmanduClock', () => {
  it('is UTC+5:45 all year', () => {
    expect(kathmanduClock(SAT_10AM)).toEqual({ day: 6, minutes: 600 });
    // 18:30 UTC on Friday is already 00:15 on Saturday in Kathmandu.
    expect(kathmanduClock(new Date('2026-10-02T18:30:00Z'))).toEqual({ day: 6, minutes: 15 });
  });
});

describe('precedence', () => {
  const ctx = { vehicleId: BUS, operatorId: COMPANY, routeId: ROUTE, direction: 'FORWARD' as const, at: SAT_10AM };

  it('runs bus, company, route this way, route both ways, then default, then the current issue', () => {
    const p = contentFor([
      placement('default', { scope: 'DEFAULT', routeId: null }),
      placement('route-both'),
      placement('route-forward', { direction: 'FORWARD' }),
      placement('company', { scope: 'OPERATOR', operatorId: COMPANY, routeId: null }),
      placement('bus', { scope: 'VEHICLE', vehicleId: BUS, routeId: null }),
    ], [article('issue')], ctx);
    expect(ids(p)).toEqual(['bus', 'company', 'route-forward', 'route-both', 'default', 'issue']);
    expect(p.lead?.level).toBe('VEHICLE');
  });

  it("lets a bus's own lead beat its route's pinned lead, and restores the route's when removed", () => {
    const routeList = [
      placement('route-lead', { isPinned: true, position: 5 }),
      placement('route-second', { position: 1 }),
    ];
    const withBus = contentFor([...routeList, placement('bus-story', { scope: 'VEHICLE', vehicleId: BUS, routeId: null })], [], ctx);
    expect(withBus.lead?.article.id).toBe('bus-story');

    const without = contentFor(routeList, [], ctx);
    expect(ids(without)).toEqual(['route-lead', 'route-second']);
  });

  it("ignores another bus's, another company's and another route's placements", () => {
    const p = contentFor([
      placement('other-bus', { scope: 'VEHICLE', vehicleId: 'bus-2', routeId: null }),
      placement('other-company', { scope: 'OPERATOR', operatorId: 'company-2', routeId: null }),
      placement('other-route', { routeId: OTHER_ROUTE }),
      placement('mine'),
    ], [], ctx);
    expect(ids(p)).toEqual(['mine']);
  });

  it("drops a bus or company placement narrowed to a road the bus is no longer on", () => {
    const p = contentFor([
      placement('bus-old-road', { scope: 'VEHICLE', vehicleId: BUS, routeId: OTHER_ROUTE }),
      placement('company-this-road', { scope: 'OPERATOR', operatorId: COMPANY, routeId: ROUTE }),
    ], [], ctx);
    expect(ids(p)).toEqual(['company-this-road']);
  });

  it('within a level: pinned, then position, then featured, then newest', () => {
    const p = contentFor([
      placement('pos-2', { position: 2 }),
      placement('pinned', { position: 9, isPinned: true }),
      placement('pos-1-old', { position: 1, article: article('pos-1-old', { publishedAt: '2026-01-01T00:00:00Z' }) }),
      placement('pos-1-new', { position: 1, article: article('pos-1-new', { publishedAt: '2026-09-30T00:00:00Z' }) }),
      placement('pos-1-featured', { position: 1, article: article('pos-1-featured', { isFeatured: true, publishedAt: '2025-01-01T00:00:00Z' }) }),
    ], [], ctx);
    expect(ids(p)).toEqual(['pinned', 'pos-1-featured', 'pos-1-new', 'pos-1-old', 'pos-2']);
  });
});

describe('direction', () => {
  const list = [
    placement('to-pokhara', { direction: 'FORWARD' }),
    placement('to-kathmandu', { direction: 'REVERSE' }),
    placement('either-way'),
  ];

  it('shows each direction its own stories', () => {
    const forward = contentFor(list, [], { routeId: ROUTE, direction: 'FORWARD', at: SAT_10AM });
    const reverse = contentFor(list, [], { routeId: ROUTE, direction: 'REVERSE', at: SAT_10AM });
    expect(forward.lead?.article.id).toBe('to-pokhara');
    expect(reverse.lead?.article.id).toBe('to-kathmandu');
    expect(ids(forward)).not.toContain('to-kathmandu');
  });

  it('shows only both-way content until the direction is known', () => {
    const p = contentFor(list, [], { routeId: ROUTE, direction: null, at: SAT_10AM });
    expect(ids(p)).toEqual(['either-way']);
  });

  it('applies direction to bus and company placements too', () => {
    const p = contentFor([
      placement('bus-reverse', { scope: 'VEHICLE', vehicleId: BUS, routeId: null, direction: 'REVERSE' }),
    ], [], { vehicleId: BUS, routeId: ROUTE, direction: 'FORWARD', at: SAT_10AM });
    expect(ids(p)).toEqual([]);
  });

  it('keeps a direction-only placement out of levelOf when no direction is known', () => {
    expect(levelOf(placement('x', { direction: 'FORWARD' }), { routeId: ROUTE, at: SAT_10AM })).toBeNull();
  });
});

describe('scheduling (Asia/Kathmandu)', () => {
  it('respects start and end, end exclusive', () => {
    const p = { startsAt: '2026-10-03T04:00:00Z', endsAt: '2026-10-03T04:15:00Z', daysOfWeek: [], timeFrom: null, timeTo: null };
    expect(isLive(p, new Date('2026-10-03T03:59:59Z'))).toBe(false);
    expect(isLive(p, new Date('2026-10-03T04:00:00Z'))).toBe(true);
    expect(isLive(p, new Date('2026-10-03T04:15:00Z'))).toBe(false);
  });

  it('checks the day in Kathmandu, not in UTC', () => {
    const saturdays = { startsAt: null, endsAt: null, daysOfWeek: [6], timeFrom: null, timeTo: null };
    // Friday 18:30 UTC is Saturday 00:15 in Kathmandu.
    expect(isLive(saturdays, new Date('2026-10-02T18:30:00Z'))).toBe(true);
    expect(isLive(saturdays, new Date('2026-10-02T18:00:00Z'))).toBe(false);
  });

  it('runs a daytime window between its hours only', () => {
    const daytime = { startsAt: null, endsAt: null, daysOfWeek: [], timeFrom: '06:00', timeTo: '18:00' };
    expect(isLive(daytime, SAT_10AM)).toBe(true);
    expect(isLive(daytime, new Date('2026-10-03T12:15:00Z'))).toBe(false); // 18:00 local, end exclusive
    expect(isLive(daytime, new Date('2026-10-03T00:14:00Z'))).toBe(false); // 05:59 local
  });

  it('runs a night-bus window past midnight, counted on the day it opened', () => {
    const fridayNights = { startsAt: null, endsAt: null, daysOfWeek: [5], timeFrom: '22:00', timeTo: '02:00' };
    expect(isLive(fridayNights, new Date('2026-10-02T16:15:00Z'))).toBe(true);  // Fri 22:00
    expect(isLive(fridayNights, new Date('2026-10-02T19:15:00Z'))).toBe(true);  // Sat 01:00, still Friday's window
    expect(isLive(fridayNights, new Date('2026-10-02T20:15:00Z'))).toBe(false); // Sat 02:00
    expect(isLive(fridayNights, new Date('2026-10-03T16:15:00Z'))).toBe(false); // Sat 22:00, not a Friday
    expect(isLive(fridayNights, new Date('2026-10-02T15:45:00Z'))).toBe(false); // Fri 21:30
  });

  it('drops a placement outside its window from the programme', () => {
    const p = contentFor([
      placement('night-only', { timeFrom: '20:00', timeTo: '05:00' }),
      placement('always'),
    ], [], { routeId: ROUTE, at: SAT_10AM });
    expect(ids(p)).toEqual(['always']);
  });
});

describe('de-duplication and the shelf', () => {
  it('keeps one copy of an article, at its most specific level', () => {
    const p = contentFor([
      placement('shared', { scope: 'DEFAULT', routeId: null }),
      placement('shared'),
      placement('shared', { scope: 'VEHICLE', vehicleId: BUS, routeId: null }),
    ], [article('shared')], { vehicleId: BUS, routeId: ROUTE, at: SAT_10AM });
    expect(ids(p)).toEqual(['shared']);
    expect(p.lead?.level).toBe('VEHICLE');
  });

  it('skips a placement that is not live in favour of a live one for the same article', () => {
    const p = contentFor([
      placement('story', { scope: 'VEHICLE', vehicleId: BUS, routeId: null, endsAt: '2026-01-01T00:00:00Z' }),
      placement('story'),
    ], [], { vehicleId: BUS, routeId: ROUTE, at: SAT_10AM });
    expect(p.lead?.level).toBe('ROUTE_BOTH');
  });

  it(`returns a lead, ${SHELF_SIZE} more, and the rest for "More from this issue"`, () => {
    const many = Array.from({ length: 20 }, (_, i) => placement(`a${i}`, { position: i }));
    const p = contentFor(many, [], { routeId: ROUTE, at: SAT_10AM });
    expect(p.lead?.article.id).toBe('a0');
    expect(p.stories).toHaveLength(SHELF_SIZE);
    expect(p.more.map((x) => x.article.id)).toEqual(['a13', 'a14', 'a15', 'a16', 'a17', 'a18', 'a19']);
  });

  it('falls back to the current issue when nothing is programmed', () => {
    const p = contentFor([], [article('issue-1'), article('issue-2')], { routeId: ROUTE, at: SAT_10AM });
    expect(ids(p)).toEqual(['issue-1', 'issue-2']);
    expect(p.lead?.level).toBe('DEFAULT');
  });
});
