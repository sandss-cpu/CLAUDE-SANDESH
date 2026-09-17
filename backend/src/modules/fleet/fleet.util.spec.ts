import {
  DAY_MS, daysBetween, expiry, mileage, normalisePlate, plateLooksValid,
  serviceDue, tidyPlate, topWords,
} from './fleet.util';

describe('normalisePlate', () => {
  /**
   * The point of the key: one physical bus cannot be registered twice by
   * writing its number differently.
   */
  it.each([
    'Ba 2 Kha 3456',
    'BA-2-KHA-3456',
    'ba2kha3456',
    '  ba 2 kha 3456  ',
  ])('treats %p as the same bus', (written) => {
    expect(normalisePlate(written)).toBe('BA2KHA3456');
  });

  it('reads Devanagari digits as the same number', () => {
    expect(normalisePlate('ba2kha३४५६')).toBe('BA2KHA3456');
  });

  /**
   * Devanagari letters survive, but combining vowel signs do not: "बा" is
   * ब + ा (U+093E), and the sign is a mark, not a letter or a number, so the
   * key strips it.
   *
   * This pins what the key does today rather than what it ideally would do.
   * Two numbers differing only by a vowel sign currently collide, which for a
   * uniqueness key is the wrong direction to fail in — but the SQL backfill in
   * the bus_owner_portal migration normalises the same way, so changing it is a
   * migration and a re-key, not a quiet edit to this function.
   */
  it('keeps Devanagari letters, dropping combining vowel signs', () => {
    expect(normalisePlate('बा २ ख ३४५६')).toBe('ब2ख3456');
  });
});

describe('tidyPlate', () => {
  it('is for display: spaced and upper case, not stripped', () => {
    expect(tidyPlate('  ba  2   kha 3456 ')).toBe('BA 2 KHA 3456');
  });
});

describe('plateLooksValid', () => {
  it('accepts a real key', () => {
    expect(plateLooksValid('BA2KHA3456')).toBe(true);
  });

  it('rejects something too short', () => {
    expect(plateLooksValid('BA2')).toBe(false);
  });

  it('rejects letters with no number in them', () => {
    expect(plateLooksValid('BAKHAKHA')).toBe(false);
  });

  it('rejects something absurdly long', () => {
    expect(plateLooksValid('B1'.repeat(20))).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts whole days regardless of the time of day', () => {
    expect(daysBetween(new Date('2026-09-01T23:00:00Z'), new Date('2026-09-03T01:00:00Z'))).toBe(2);
  });

  it('goes negative for a date already passed', () => {
    expect(daysBetween(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-08T00:00:00Z'))).toBe(-2);
  });
});

describe('serviceDue', () => {
  const now = new Date('2026-09-17T00:00:00Z');
  const bus = { odometerKm: 100_000, serviceIntervalKm: 10_000, serviceIntervalDays: 180 };
  const service = (over: Partial<{ servicedAt: Date; odometerKm: number; nextDueDate: Date | null; nextDueKm: number | null }> = {}) => ({
    servicedAt: new Date('2026-06-01T00:00:00Z'),
    odometerKm: 95_000,
    nextDueDate: null,
    nextDueKm: null,
    ...over,
  });

  it('says so when a bus has never been serviced', () => {
    expect(serviceDue(bus, null, now).state).toBe('NO_RECORD');
  });

  it('is overdue once the due date has passed', () => {
    const due = serviceDue(bus, service({ nextDueDate: new Date('2026-09-01T00:00:00Z') }), now);
    expect(due.state).toBe('OVERDUE');
    expect(due.daysLeft).toBe(-16);
  });

  it('is overdue once the distance has passed, even if the date has not', () => {
    const due = serviceDue(bus, service({ nextDueKm: 99_000 }), now);
    expect(due.state).toBe('OVERDUE');
    expect(due.kmLeft).toBe(-1_000);
  });

  it('warns inside the fortnight', () => {
    expect(serviceDue(bus, service({ nextDueDate: new Date('2026-09-25T00:00:00Z') }), now).state)
      .toBe('DUE_SOON');
  });

  it('warns inside the last thousand kilometres', () => {
    expect(serviceDue(bus, service({ nextDueKm: 100_500, nextDueDate: new Date('2027-01-01T00:00:00Z') }), now).state)
      .toBe('DUE_SOON');
  });

  it('is fine when both are comfortably ahead', () => {
    expect(serviceDue(bus, service({ nextDueDate: new Date('2027-01-01T00:00:00Z'), nextDueKm: 110_000 }), now).state)
      .toBe('OK');
  });

  it('falls back to the bus intervals when the record sets no due values', () => {
    const due = serviceDue(bus, service(), now);
    expect(due.nextDueKm).toBe(105_000);                       // 95,000 + 10,000
    expect(due.nextDueDate).toEqual(new Date(new Date('2026-06-01T00:00:00Z').getTime() + 180 * DAY_MS));
  });
});

describe('expiry', () => {
  const now = new Date('2026-09-17T00:00:00Z');

  it('reports nothing to track when there is no date', () => {
    expect(expiry(null, now)).toEqual({ state: 'NONE', daysLeft: null });
  });

  it('reports an expired document', () => {
    expect(expiry(new Date('2026-09-10T00:00:00Z'), now).state).toBe('EXPIRED');
  });

  /** A month's warning: renewals in Nepal take time. */
  it('warns a month ahead', () => {
    expect(expiry(new Date('2026-10-10T00:00:00Z'), now).state).toBe('EXPIRING');
  });

  it('is fine further out', () => {
    expect(expiry(new Date('2027-01-01T00:00:00Z'), now).state).toBe('OK');
  });
});

describe('mileage', () => {
  /**
   * Only a full tank says how much was burnt since the last full tank, so a
   * partial fill in between counts towards that stretch rather than starting
   * its own.
   */
  it('measures full tank to full tank, counting partial fills in between', () => {
    const result = mileage([
      { filledAt: new Date('2026-09-01'), odometerKm: 1_000, litres: 40, costNpr: 6_000, fullTank: true },
      { filledAt: new Date('2026-09-05'), odometerKm: 1_300, litres: 20, costNpr: 3_000, fullTank: false },
      { filledAt: new Date('2026-09-09'), odometerKm: 1_500, litres: 30, costNpr: 4_500, fullTank: true },
    ]);
    expect(result.measuredKm).toBe(500);
    expect(result.kmPerLitre).toBe(10);       // 500 km on 50 litres
    expect(result.costPerKm).toBe(15);        // 7,500 rupees over 500 km
    expect(result.stretches).toHaveLength(1);
  });

  it('reports nothing measurable from a single fill', () => {
    const result = mileage([
      { filledAt: new Date('2026-09-01'), odometerKm: 1_000, litres: 40, costNpr: 6_000, fullTank: true },
    ]);
    expect(result.kmPerLitre).toBeNull();
    expect(result.measuredKm).toBe(0);
  });

  it('sorts entries that arrive out of order', () => {
    const result = mileage([
      { filledAt: new Date('2026-09-09'), odometerKm: 1_500, litres: 50, costNpr: 7_500, fullTank: true },
      { filledAt: new Date('2026-09-01'), odometerKm: 1_000, litres: 40, costNpr: 6_000, fullTank: true },
    ]);
    expect(result.measuredKm).toBe(500);
    expect(result.kmPerLitre).toBe(10);
  });
});

describe('topWords', () => {
  it('surfaces themes, not one-off words', () => {
    const words = topWords([
      'The toilet stop was clean and the cabin was comfortable',
      'Clean toilet at the stop, comfortable cabin',
    ]);
    const found = Object.fromEntries(words.map((w) => [w.word, w.count]));
    expect(found.toilet).toBe(2);
    expect(found.clean).toBe(2);
    expect(found.comfortable).toBe(2);
  });

  it('drops filler words an owner cannot act on', () => {
    const words = topWords(['the journey was very good', 'the journey was very good']);
    expect(words.map((w) => w.word)).not.toContain('journey');
    expect(words.map((w) => w.word)).not.toContain('very');
  });

  it('counts a word once per review, so one ranting review cannot dominate', () => {
    const words = topWords(['toilet toilet toilet toilet', 'cabin cabin']);
    expect(words).toEqual([]); // each appears in only one review
  });

  it('ignores empty reviews', () => {
    expect(topWords([null, undefined, ''])).toEqual([]);
  });
});
