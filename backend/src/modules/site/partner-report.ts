/**
 * The monthly partner report: what a partner got for their money. Site impressions and
 * clicks (the website's own events), profile views and contact taps in the app, enquiries
 * from both, and coupons issued and redeemed. This is what renews contracts, so every
 * number is a plain count of recorded events, by Kathmandu day.
 */

export interface DayCount { day: string; key: string; n: number }

export const REPORT_COLUMNS = [
  ['impressions', 'Website impressions'],
  ['clicks', 'Website clicks'],
  ['profileViews', 'App profile views'],
  ['contactTaps', 'Calls, WhatsApp, directions'],
  ['enquiries', 'Enquiries'],
  ['couponsIssued', 'Coupons claimed'],
  ['couponsRedeemed', 'Coupons redeemed'],
] as const;
export type ReportKey = typeof REPORT_COLUMNS[number][0];

/** Lead types that count as a contact tap: someone reaching for the phone or the map. */
export const CONTACT_TYPES = ['CALL', 'WHATSAPP', 'VIBER', 'DIRECTIONS', 'WEBSITE'];

const daysOf = (month: string): string[] => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export function partnerReport(month: string, counts: DayCount[]) {
  const empty = () => Object.fromEntries(REPORT_COLUMNS.map(([k]) => [k, 0])) as Record<ReportKey, number>;
  const byDay = new Map(daysOf(month).map((d) => [d, empty()]));
  for (const c of counts) {
    const row = byDay.get(c.day);
    if (row && c.key in row) row[c.key as ReportKey] += c.n;
  }
  const days = [...byDay.entries()].map(([day, row]) => ({ day, ...row }));
  const totals = empty();
  for (const d of days) for (const [k] of REPORT_COLUMNS) totals[k] += d[k];
  return {
    month,
    days,
    totals,
    /** Website clicks per website impression; null with no impressions. */
    ctr: totals.impressions ? Math.round((totals.clicks / totals.impressions) * 10000) / 10000 : null,
  };
}

/** "2026-10": a calendar month, refused if malformed or in the future. */
export function checkMonth(month: string | undefined, today: string): string {
  const m = month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m > today.slice(0, 7)) throw new Error('Choose a month as YYYY-MM, up to this month.');
  return m;
}
