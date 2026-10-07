import { eventTimes, kathmanduMidnight, stillOn } from './events.util';

describe('events.util', () => {
  it('finds midnight in Kathmandu, which is 18:15 UTC the day before', () => {
    // 10 October 2026, 09:30 in Kathmandu.
    expect(kathmanduMidnight(new Date('2026-10-10T03:45:00Z')).toISOString()).toBe('2026-10-09T18:15:00.000Z');
    // 00:10 on 11 October in Kathmandu is still 10 October in UTC.
    expect(kathmanduMidnight(new Date('2026-10-10T18:25:00Z')).toISOString()).toBe('2026-10-10T18:15:00.000Z');
  });

  it('keeps the times of a timed event as given', () => {
    const t = eventTimes('2026-10-10T12:15:00.000Z', '2026-10-10T15:15:00.000Z', false);
    expect(t.startsAt.toISOString()).toBe('2026-10-10T12:15:00.000Z');
    expect(t.endsAt?.toISOString()).toBe('2026-10-10T15:15:00.000Z');
  });

  it('puts an all-day event on whole Kathmandu days, and a one-day one has no end', () => {
    const many = eventTimes('2026-10-10T10:00:00.000Z', '2026-10-12T10:00:00.000Z', true);
    expect(many.startsAt.toISOString()).toBe('2026-10-09T18:15:00.000Z');
    expect(many.endsAt?.toISOString()).toBe('2026-10-11T18:15:00.000Z');
    const one = eventTimes('2026-10-10T10:00:00.000Z', '2026-10-10T16:00:00.000Z', true);
    expect(one.endsAt).toBeNull();
  });

  it('lists an event until its last day is over in Kathmandu', () => {
    const now = new Date('2026-10-10T15:00:00Z'); // 20:45 on 10 October in Kathmandu
    const where = stillOn(now) as { OR: Array<Record<string, { gte: Date }>> };
    const today = '2026-10-09T18:15:00.000Z';
    expect(where.OR[0].endsAt.gte.toISOString()).toBe(today);
    expect((where.OR[1].startsAt as { gte: Date }).gte.toISOString()).toBe(today);
  });
});
