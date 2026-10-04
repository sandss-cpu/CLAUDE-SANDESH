import { readFileSync } from 'fs';
import { join } from 'path';
import {
  adToBs, BS_RANGE, bsToAd, daysInBsMonth, formatBs, kathmanduDay, nepaliDigits,
} from './bs-date';

describe('Bikram Sambat dates', () => {
  it.each([
    // Nepali New Year's Days, and a date checked against the printed calendar.
    ['2024-04-13', { year: 2081, month: 1, day: 1 }],
    ['2025-04-14', { year: 2082, month: 1, day: 1 }],
    ['2026-04-14', { year: 2083, month: 1, day: 1 }],
    ['2025-10-03', { year: 2082, month: 6, day: 17 }],
    ['1943-04-14', { year: 2000, month: 1, day: 1 }],
    ['2034-04-13', { year: 2090, month: 12, day: 30 }],
  ])('%s AD is %o BS, and back', (ad, bs) => {
    expect(adToBs(ad)).toEqual(bs);
    expect(bsToAd(bs.year, bs.month, bs.day)).toBe(ad);
  });

  it('round-trips every day in the table', () => {
    let ad = Date.UTC(1943, 3, 14);
    const last = Date.UTC(2034, 3, 13);
    let days = 0;
    for (; ad <= last; ad += 86_400_000, days += 1) {
      const day = new Date(ad).toISOString().slice(0, 10);
      const bs = adToBs(day)!;
      expect(bsToAd(bs.year, bs.month, bs.day)).toBe(day);
    }
    expect(days).toBe(33_238);
  });

  it('reads an instant as the day it is in Kathmandu', () => {
    // 18:15 UTC on 13 April 2026 is already 00:00 on the 14th, New Year's Day 2083, in Kathmandu.
    expect(kathmanduDay('2026-04-13T18:15:00Z')).toBe('2026-04-14');
    expect(adToBs(new Date('2026-04-13T18:15:00Z'))).toEqual({ year: 2083, month: 1, day: 1 });
    expect(adToBs(new Date('2026-04-13T18:14:00Z'))).toEqual({ year: 2082, month: 12, day: 30 }); // Chaitra 2082 has 30 days
  });

  it('refuses dates outside the table and impossible BS dates', () => {
    expect(adToBs('1943-04-13')).toBeNull();
    expect(adToBs('2034-04-14')).toBeNull();
    expect(bsToAd(2082, 13, 1)).toBeNull();
    expect(bsToAd(2082, 1, 32)).toBeNull();
    expect(bsToAd(BS_RANGE.last + 1, 1, 1)).toBeNull();
    expect(daysInBsMonth(2082, 1)).toBe(31);
  });

  it('formats in English and Nepali', () => {
    expect(formatBs('2025-10-03')).toBe('17 Asoj 2082');
    expect(formatBs('2025-10-03', 'ne')).toBe('२०८२ असोज १७');
    expect(nepaliDigits('2082-06-17')).toBe('२०८२-०६-१७');
    expect(formatBs('2040-01-01')).toBe('');
  });

  it('has a browser copy generated from this file', () => {
    // scripts/sync-web-libs.mjs writes it; run that after changing bs-date.ts.
    const web = readFileSync(join(__dirname, '../../../../web/js/lib/bs-date.js'), 'utf8');
    const source = readFileSync(join(__dirname, 'bs-date.ts'), 'utf8');
    const hash = require('crypto').createHash('sha256').update(source).digest('hex').slice(0, 16);
    expect(web).toContain(`source sha256 ${hash}`);
  });
});
