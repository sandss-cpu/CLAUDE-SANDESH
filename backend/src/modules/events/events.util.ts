import { Prisma } from '@prisma/client';

/** Kathmandu is UTC+5:45 all year (no daylight saving). */
export const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;

/** Midnight in Kathmandu on the day `d` falls on there, as a UTC instant. */
export function kathmanduMidnight(d: Date): Date {
  const local = new Date(d.getTime() + NPT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - NPT_OFFSET_MS);
}

/**
 * An event is still on until its last day is over in Kathmandu: one that ends (or, with
 * no end, starts) any time today is still listed today.
 */
export function stillOn(now: Date = new Date()): Prisma.EventWhereInput {
  const today = kathmanduMidnight(now);
  return { OR: [{ endsAt: { gte: today } }, { endsAt: null, startsAt: { gte: today } }] };
}

export function over(now: Date = new Date()): Prisma.EventWhereInput {
  const today = kathmanduMidnight(now);
  return { OR: [{ endsAt: { lt: today } }, { endsAt: null, startsAt: { lt: today } }] };
}

/**
 * The times an editor gave, made consistent. An all-day event runs from midnight on its
 * first day to midnight on its last day (inclusive), so the dates are all that count.
 */
export function eventTimes(startsAt: string, endsAt: string | null | undefined, allDay: boolean) {
  let start = new Date(startsAt);
  let end = endsAt ? new Date(endsAt) : null;
  if (allDay) {
    start = kathmanduMidnight(start);
    end = end ? kathmanduMidnight(end) : null;
    if (end && end.getTime() === start.getTime()) end = null;
  }
  return { startsAt: start, endsAt: end };
}
