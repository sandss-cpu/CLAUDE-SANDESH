/* eslint-disable @typescript-eslint/no-var-requires */
import { join } from 'path';

/** The BS calendar the reader uses, copied in by scripts/prepare.mjs. */
const BsDate: { formatBs(d: string | Date): string } = require(join(__dirname, '../../vendor/bs-date.js')).BsDate;

const NPT_OFFSET_MS = (5 * 60 + 45) * 60_000;
/** The calendar day in Kathmandu, as YYYY-MM-DD: after 18:15 UTC it is already tomorrow there. */
export const kathmanduDay = (d: Date | string) => new Date(new Date(d).getTime() + NPT_OFFSET_MS).toISOString().slice(0, 10);

export const dayAd = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kathmandu' });
export const dayBs = (d: Date | string) => BsDate.formatBs(kathmanduDay(d));
/** "4 October 2026 · 18 Asoj 2083". */
export const dayBoth = (d: Date | string) => [dayAd(d), dayBs(d)].filter(Boolean).join(' · ');
export const isoDate = (d: Date | string) => new Date(d).toISOString();
/** "18:30" in Kathmandu. */
export const timeNpt = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kathmandu' });
const part = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Date(d).toLocaleDateString('en-GB', { ...o, timeZone: 'Asia/Kathmandu' });
/** For an event's date badge: "Sat", "10", "Oct". */
export const badge = (d: Date | string) => ({ weekday: part(d, { weekday: 'short' }), day: part(d, { day: 'numeric' }), month: part(d, { month: 'short' }) });
/** "October 2026", the heading events are grouped under. */
export const monthAd = (d: Date | string) => part(d, { month: 'long', year: 'numeric' });

export const EVENT_KIND: Record<string, string> = {
  FESTIVAL: 'Festival', MUSIC: 'Music', FOOD: 'Food', CULTURE: 'Culture', SPORT: 'Sport', OUTDOORS: 'Outdoors',
  MARKET: 'Market', EXHIBITION: 'Exhibition', OTHER: 'Event',
};

/**
 * When an event happens, in words: "Saturday 10 October 2026, 18:00–21:00", or a range of
 * days. Always Kathmandu time, with the BS date beside it.
 */
export function eventWhen(e: { startsAt: Date; endsAt: Date | null; allDay: boolean }): { ad: string; bs: string } {
  const long = (d: Date) => part(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sameDay = !e.endsAt || kathmanduDay(e.endsAt) === kathmanduDay(e.startsAt);
  const bs = sameDay ? dayBs(e.startsAt) : `${dayBs(e.startsAt)} – ${dayBs(e.endsAt!)}`;
  if (e.allDay) return { ad: sameDay ? long(e.startsAt) : `${long(e.startsAt)} – ${long(e.endsAt!)}`, bs };
  if (sameDay) return { ad: `${long(e.startsAt)}, ${timeNpt(e.startsAt)}${e.endsAt ? `–${timeNpt(e.endsAt)}` : ''}`, bs };
  return { ad: `${long(e.startsAt)}, ${timeNpt(e.startsAt)} – ${long(e.endsAt!)}, ${timeNpt(e.endsAt!)}`, bs };
}

export const CATEGORY_LABEL: Record<string, string> = {
  HOTEL: 'Hotel', HOMESTAY: 'Homestay', LODGE: 'Lodge', RESTAURANT: 'Restaurant', CAFE: 'Café', TREKKING_AGENCY: 'Trekking agency',
  ADVENTURE: 'Adventure', PARAGLIDING: 'Paragliding', RENTAL: 'Rentals', GUIDE: 'Guide', HANDICRAFT: 'Handicrafts',
  TOUR_OPERATOR: 'Tours', TRANSPORT: 'Transport',
};
export const STOP_LABEL: Record<string, string> = {
  LANDMARK: 'Landmark', VIEWPOINT: 'Viewpoint', FOOD: 'Food', HOTEL: 'Stay', REST_STOP: 'Rest stop', FUEL: 'Fuel', ATM: 'ATM',
  HOSPITAL: 'Hospital', TEMPLE: 'Temple', SHOPPING: 'Shopping', ACTIVITY: 'Activity', OTHER: 'Stop',
};
/** schema.org types for partners' JSON-LD. */
export const SCHEMA_TYPE: Record<string, string> = {
  HOTEL: 'Hotel', HOMESTAY: 'LodgingBusiness', LODGE: 'LodgingBusiness', RESTAURANT: 'Restaurant', CAFE: 'CafeOrCoffeeShop',
  TREKKING_AGENCY: 'TravelAgency', TOUR_OPERATOR: 'TravelAgency', GUIDE: 'TravelAgency', ADVENTURE: 'SportsActivityLocation',
  PARAGLIDING: 'SportsActivityLocation', RENTAL: 'AutoRental', HANDICRAFT: 'Store', TRANSPORT: 'LocalBusiness',
};
/** A digits-only number for tel:, WhatsApp and Viber links; Nepali mobiles get +977. */
export function intlNumber(n: string | null | undefined): string | null {
  const d = String(n ?? '').replace(/\D/g, '');
  if (d.length < 7) return null;
  return d.length === 10 && d.startsWith('9') ? `977${d}` : d;
}
