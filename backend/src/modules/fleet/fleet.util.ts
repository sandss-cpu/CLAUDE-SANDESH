import { customAlphabet } from 'nanoid';

export const DAY_MS = 86_400_000;

/** A service is "due soon" inside either of these, whichever comes first. */
export const SERVICE_SOON_DAYS = 14;
export const SERVICE_SOON_KM = 1_000;
/** Documents and driving licences get a month's warning: renewals in Nepal take time. */
export const EXPIRY_SOON_DAYS = 30;

/**
 * Profile QR codes are longer than seat stickers (10 characters, about 10^15
 * combinations) so nobody can walk the code space to find buses to spam.
 * Same alphabet as slug.util: no 0, O, 1 or I.
 */
export const profileCode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10);

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/**
 * The uniqueness key for a registration number. "Ba 2 Kha 3456", "BA-2-KHA-3456"
 * and "ba2kha३४५६" are one bus, so one physical bus can't be registered twice by
 * writing its plate differently. Keep in step with the backfill in the
 * bus_owner_portal migration.
 */
export function normalisePlate(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** How the number is shown: trimmed, single-spaced, upper case. */
export function tidyPlate(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function plateLooksValid(key: string): boolean {
  return key.length >= 4 && key.length <= 20 && /\p{N}/u.test(key);
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const daysBetween = (from: Date, to: Date) => Math.round((utcDay(to) - utcDay(from)) / DAY_MS);

export type ServiceState = 'OVERDUE' | 'DUE_SOON' | 'OK' | 'NO_RECORD';

export interface ServiceDue {
  state: ServiceState;
  lastServicedAt: Date | null;
  lastServiceKm: number | null;
  nextDueDate: Date | null;
  nextDueKm: number | null;
  daysLeft: number | null;
  kmLeft: number | null;
}

/**
 * When the next routine service falls due: by date or by distance, whichever is
 * sooner. A record's own next-due values win over the bus's standard intervals.
 */
export function serviceDue(
  bus: { odometerKm: number; serviceIntervalKm: number; serviceIntervalDays: number },
  last: { servicedAt: Date; odometerKm: number; nextDueDate: Date | null; nextDueKm: number | null } | null | undefined,
  now = new Date(),
): ServiceDue {
  if (!last) {
    return {
      state: 'NO_RECORD', lastServicedAt: null, lastServiceKm: null,
      nextDueDate: null, nextDueKm: null, daysLeft: null, kmLeft: null,
    };
  }
  const nextDueDate = last.nextDueDate ?? new Date(last.servicedAt.getTime() + bus.serviceIntervalDays * DAY_MS);
  const nextDueKm = last.nextDueKm ?? last.odometerKm + bus.serviceIntervalKm;
  const daysLeft = daysBetween(now, nextDueDate);
  const kmLeft = nextDueKm - bus.odometerKm;
  const state: ServiceState = daysLeft < 0 || kmLeft < 0 ? 'OVERDUE'
    : daysLeft <= SERVICE_SOON_DAYS || kmLeft <= SERVICE_SOON_KM ? 'DUE_SOON'
    : 'OK';
  return {
    state, lastServicedAt: last.servicedAt, lastServiceKm: last.odometerKm,
    nextDueDate, nextDueKm, daysLeft, kmLeft,
  };
}

export type ExpiryState = 'EXPIRED' | 'EXPIRING' | 'OK' | 'NONE';

export function expiry(expiresAt: Date | null | undefined, now = new Date()) {
  if (!expiresAt) return { state: 'NONE' as ExpiryState, daysLeft: null as number | null };
  const daysLeft = daysBetween(now, expiresAt);
  const state: ExpiryState = daysLeft < 0 ? 'EXPIRED' : daysLeft <= EXPIRY_SOON_DAYS ? 'EXPIRING' : 'OK';
  return { state, daysLeft };
}

export interface FuelEntry { filledAt: Date; odometerKm: number; litres: number; costNpr: number; fullTank: boolean }

/**
 * Fuel economy from fill-ups. Only a full tank tells you how much was burnt
 * since the last full tank, so each measured stretch runs full → full, and the
 * litres of any partial fills in between count towards it.
 */
export function mileage(entries: FuelEntry[]) {
  const logs = [...entries].sort((a, b) => a.odometerKm - b.odometerKm || a.filledAt.getTime() - b.filledAt.getTime());
  const stretches: Array<{ endedAt: Date; km: number; litres: number; kmPerLitre: number }> = [];
  let lastFull: FuelEntry | null = null;
  let litresSince = 0;
  let costSince = 0;
  let measuredKm = 0;
  let measuredLitres = 0;
  let measuredCost = 0;

  for (const log of logs) {
    if (lastFull) {
      litresSince += log.litres;
      costSince += log.costNpr;
    }
    if (log.fullTank) {
      if (lastFull) {
        const km = log.odometerKm - lastFull.odometerKm;
        if (km > 0 && litresSince > 0) {
          stretches.push({ endedAt: log.filledAt, km, litres: +litresSince.toFixed(2), kmPerLitre: +(km / litresSince).toFixed(2) });
          measuredKm += km;
          measuredLitres += litresSince;
          measuredCost += costSince;
        }
      }
      lastFull = log;
      litresSince = 0;
      costSince = 0;
    }
  }

  return {
    kmPerLitre: measuredLitres > 0 ? +(measuredKm / measuredLitres).toFixed(2) : null,
    costPerKm: measuredKm > 0 ? +(measuredCost / measuredKm).toFixed(2) : null,
    measuredKm,
    stretches: stretches.slice(-12),
  };
}

export const round1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

const STOP_WORDS = new Set((
  'the and for with that this was were are but not have has had very bus from they them there their ' +
  'our out all you your its also just too can will would could should been being into over more most ' +
  'some than then when what which who how about after before again only really good nice great ' +
  'journey trip ride seat seats time travel travelled traveled driver staff'
).split(' '));

/** The words passengers keep using, so an owner sees themes rather than reading every review. */
export function topWords(texts: Array<string | null | undefined>, limit = 12) {
  const counts = new Map<string, number>();
  for (const text of texts) {
    if (!text) continue;
    const seen = new Set<string>();
    for (const word of text.toLowerCase().match(/[\p{L}]{4,}/gu) ?? []) {
      if (STOP_WORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
