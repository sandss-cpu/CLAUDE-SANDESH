import { readFileSync } from 'fs';
import { join } from 'path';
import { buildTimeline, openState, whatsappUrl } from './stops';

/** 14:30 in Kathmandu is 08:45 UTC. */
const ktm = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+05:45`);

describe('opening hours', () => {
  it('reads the ways editors write hours', () => {
    expect(openState('6am–9pm', ktm('14:30'))).toEqual({ state: 'open', label: 'Open now · until 9pm' });
    expect(openState('06:00-21:00', ktm('22:15'))).toEqual({ state: 'closed', label: 'Closed · opens 6am' });
    expect(openState('7 am to 10:30 pm daily', ktm('22:00')).label).toBe('Open now · until 10:30pm');
    expect(openState('Open 24 hours', ktm('03:00')).state).toBe('open');
    expect(openState('६am–९pm', ktm('08:00')).state).toBe('open');
  });
  it('works out the half of the day from the end time', () => {
    expect(openState('6–9pm', ktm('19:00')).state).toBe('open');   // 6pm to 9pm
    expect(openState('10–6pm', ktm('11:00')).state).toBe('open');  // 10am to 6pm
    expect(openState('10am–6', ktm('17:00')).state).toBe('open');  // 10am to 6pm
  });
  it('handles hours past midnight and split hours', () => {
    expect(openState('6pm–2am', ktm('01:00')).state).toBe('open');
    expect(openState('6pm–2am', ktm('03:00')).label).toBe('Closed · opens 6pm');
    expect(openState('6–10am, 4–9pm', ktm('12:00')).label).toBe('Closed · opens 4pm');
  });
  it('says nothing rather than guess', () => {
    expect(openState('Ask at the counter', ktm('12:00')).state).toBe('unknown');
    expect(openState(null, ktm('12:00')).state).toBe('unknown');
  });
});

describe('stops timeline', () => {
  const route = { startPlace: 'Kathmandu', endPlace: 'Pokhara', distanceKm: 200, typicalHours: 7 };
  const stops = [
    { id: 's1', kind: 'REST_STOP', name: 'Naubise tea', distanceFromStartKm: 25, minutesFromStart: 50 },
    { id: 's2', kind: 'FOOD', name: 'Malekhu fish', distanceFromStartKm: 60, minutesFromStart: 120, openingHours: '6am–9pm' },
    { id: 's3', kind: 'FUEL', name: 'Mugling fuel', distanceFromStartKm: 110, minutesFromStart: 220, businessId: 'b1' },
    { id: 's4', kind: 'VIEWPOINT', name: 'Bandipur turn', distanceFromStartKm: 140 },
    { id: 's5', kind: 'ATM', name: 'Damauli ATM', distanceFromStartKm: 160, minutesFromStart: 330 },
    { id: 's6', kind: 'HOTEL', name: 'Lakeside hotel', distanceFromStartKm: 199, minutesFromStart: 415 },
  ];
  const businesses = [
    { id: 'b1', slug: 'mugling-fuel', name: 'Mugling Fuel Station', category: 'OTHER', phone: '9856000000', verifiedAt: '2026-01-01' },
    { id: 'b2', slug: 'kaski-lodge', name: 'Fewa Lodge', category: 'LODGE', district: 'Kaski', whatsapp: '9846000000' },
    { id: 'b3', slug: 'roadside-cafe', name: 'Roadside Café', category: 'CAFE', district: 'Dhading' },
  ];
  const now = ktm('09:00');

  it('orders the road by time, two hours in, with what is passed counted', () => {
    const t = buildTimeline({ stops, businesses, route, direction: 'FORWARD', minutesElapsed: 120, now });
    expect(t.destination).toBe('Pokhara');
    // Naubise (50 min) is behind; Malekhu (120) is where the bus is now.
    expect(t.passed).toBe(1);
    expect(t.comingUp.map((s) => s.name)).toEqual(['Malekhu fish', 'Mugling Fuel Station', 'Bandipur turn']);
    // Bandipur has no time: 140 km at 7 h / 200 km = 2.1 min per km is 294 min, 174 after the two hours gone.
    expect(t.comingUp.map((s) => s.inMinutes)).toEqual([0, 100, 174]);
    expect(t.later.map((s) => s.name)).toEqual(['Damauli ATM']);
    expect(t.atDestination.map((s) => s.name)).toEqual(['Lakeside hotel', 'Fewa Lodge']);
    expect(t.alongTheRoad.map((s) => s.name)).toEqual(['Roadside Café']);
    expect(t.total).toBe(7);
  });

  it('joins a listed business with its place on the road guide, labelled as paid', () => {
    const t = buildTimeline({ stops, businesses, route, direction: 'FORWARD', minutesElapsed: 0, now });
    const mugling = [...t.comingUp, ...t.later].find((s) => s.key === 'stop:s3')!;
    expect(mugling).toMatchObject({ name: 'Mugling Fuel Station', km: 110, verified: true, paid: true, phone: '9856000000', slug: 'mugling-fuel' });
    expect([...t.comingUp, ...t.later, ...t.alongTheRoad].filter((s) => s.slug === 'mugling-fuel')).toHaveLength(1);
    expect(t.passed).toBe(0);
  });

  it('filters by what the traveller needs', () => {
    const t = buildTimeline({ stops, businesses, route, direction: 'FORWARD', minutesElapsed: null, now, filter: 'stay' });
    expect([...t.comingUp, ...t.later, ...t.alongTheRoad].length).toBe(0);
    expect(t.atDestination.map((s) => s.name)).toEqual(['Lakeside hotel', 'Fewa Lodge']);
  });

  it('heads for the start place on the way back', () => {
    const t = buildTimeline({ stops: [], businesses, route, direction: 'REVERSE', minutesElapsed: null, now });
    expect(t.destination).toBe('Kathmandu');
    expect(t.atDestination).toEqual([]);
  });

  it('makes WhatsApp links from Nepali numbers', () => {
    expect(whatsappUrl('984-600 0000')).toBe('https://wa.me/9779846000000');
    expect(whatsappUrl('+977 9846000000')).toBe('https://wa.me/9779846000000');
    expect(whatsappUrl('01-44')).toBeNull();
  });

  it('has a browser copy generated from this file', () => {
    // scripts/sync-web-libs.mjs writes it; run that after changing stops.ts.
    const web = readFileSync(join(__dirname, '../../../../web/js/lib/stops.js'), 'utf8');
    const source = readFileSync(join(__dirname, 'stops.ts'), 'utf8');
    const hash = require('crypto').createHash('sha256').update(source).digest('hex').slice(0, 16);
    expect(web).toContain(`source sha256 ${hash}`);
  });
});
