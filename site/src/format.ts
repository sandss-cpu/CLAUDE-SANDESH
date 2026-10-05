/* eslint-disable @typescript-eslint/no-var-requires */
import { join } from 'path';

/** The BS calendar the reader uses, copied in by scripts/prepare.mjs. */
const BsDate: { formatBs(d: string | Date): string } = require(join(__dirname, '../../vendor/bs-date.js')).BsDate;

export const dayAd = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kathmandu' });
export const dayBs = (d: Date | string) => BsDate.formatBs(new Date(d).toISOString().slice(0, 10));
/** "4 October 2026 · 18 Asoj 2083". */
export const dayBoth = (d: Date | string) => [dayAd(d), dayBs(d)].filter(Boolean).join(' · ');
export const isoDate = (d: Date | string) => new Date(d).toISOString();

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
