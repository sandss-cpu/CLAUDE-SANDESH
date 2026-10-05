import {
  ScoreFuel, ScoreReview, ScoreTrip, bayesian, commentThemes, fuelEconomy, incidentSummary, monthlyTrend,
  passengerScores, rankDrivers, suggestScores, tankStretches, tripTotals,
} from './scorecard';
import { scriptRuns } from './appraisal-pdf';

/**
 * A hand-worked fixture. Every expected number below was calculated on paper first; the
 * working is in the comments, so a failure says which step disagrees.
 */
const at = (iso: string) => new Date(iso);
const review = (overall: number, extra: Partial<ScoreReview> = {}): ScoreReview => ({
  createdAt: at('2026-09-10T06:00:00Z'), overall, driving: null, punctuality: null, staff: null,
  comment: null, suggestion: null, tripId: 't', ...extra,
});

// Driver A: ten 5s and two 3s overall (sum 56, n 12). Driving on ten of them: eight 5s and two 4s (sum 48).
// Punctuality on four. Staff on none.
const driverA: ScoreReview[] = [
  ...Array.from({ length: 8 }, () => review(5, { driving: 5 })),
  review(5, { driving: 4, punctuality: 4 }),
  review(5, { driving: 4, punctuality: 5 }),
  review(3, { punctuality: 3 }),
  review(3, { punctuality: 2, tripId: null }),
];
// Driver B: three 5s (sum 15), one with a driving score of 5.
const driverB: ScoreReview[] = [review(5, { driving: 5 }), review(5), review(5)];
// Driver C: five 2s (sum 10).
const driverC: ScoreReview[] = Array.from({ length: 5 }, () => review(2));
const company = [...driverA, ...driverB, ...driverC];

describe('scorecard: passenger scores', () => {
  it('pulls each driver towards the company mean by ten reviews', () => {
    // Company overall: sum 56 + 15 + 10 = 81 over 20 reviews = 4.05.
    // A: (10 × 4.05 + 56) / (10 + 12) = 96.5 / 22 = 4.386… → 4.39
    const a = passengerScores(driverA, company);
    expect(a.scores.overall).toEqual({ n: 12, mean: 4.67, adjusted: 4.39, companyMean: 4.05, enough: true });
    expect(a.reviews).toBe(12);
    expect(a.fromTrips).toBe(11);
    expect(a.enough).toBe(true);
    expect(a.label).toBeNull();

    // Company driving: A's ten (48) + B's one (5) = 53 over 11 = 4.818… → 4.82 (rounded before use).
    // A driving: (10 × 4.82 + 48) / (10 + 10) = 96.2 / 20 = 4.81
    expect(a.scores.driving).toEqual({ n: 10, mean: 4.8, adjusted: 4.81, companyMean: 4.82, enough: true });
    // Punctuality on only four reviews: not enough to suggest anything.
    expect(a.scores.punctuality.n).toBe(4);
    expect(a.scores.punctuality.enough).toBe(false);
    expect(a.scores.staff).toEqual({ n: 0, mean: null, adjusted: null, companyMean: null, enough: false });
  });

  it('says "Not enough reviews yet" below ten reviews, however good they are', () => {
    // B: (40.5 + 15) / 13 = 4.269… → 4.27, below A despite three perfect reviews.
    const b = passengerScores(driverB, company);
    expect(b.scores.overall.adjusted).toBe(4.27);
    expect(b.enough).toBe(false);
    expect(b.label).toBe('Not enough reviews yet');
    // C: (40.5 + 10) / 15 = 3.366… → 3.37
    expect(passengerScores(driverC, company).scores.overall.adjusted).toBe(3.37);
  });

  it('has no score without reviews, and the plain mean without a company prior', () => {
    expect(bayesian(0, 0, 4)).toBeNull();
    expect(bayesian(9, 2, null)).toBe(4.5);
  });

  it('groups the trend by Kathmandu month', () => {
    // 20:00 UTC on 31 August is 01:45 on 1 September in Kathmandu.
    const trend = monthlyTrend([
      review(4, { createdAt: at('2026-08-31T20:00:00Z') }),
      review(2, { createdAt: at('2026-09-02T06:00:00Z') }),
      review(5, { createdAt: at('2026-08-15T06:00:00Z') }),
    ]);
    expect(trend).toEqual([
      { month: '2026-08', reviews: 1, overall: 5 },
      { month: '2026-09', reviews: 2, overall: 3 },
    ]);
  });
});

describe('scorecard: what passengers wrote', () => {
  it('counts praise and complaint themes once per review, in English and Nepali', () => {
    const themes = commentThemes([
      'Very polite conductor and clean bus',
      'राम्रो व्यवहार, सुरक्षित यात्रा',
      'Driver was not safe at all', // negated praise counts as the complaint
      'Overtaking on blind bends, overtaking again',
      'very rash driving',
      'Bus left late',
      'Not late at all, we will travel later too', // neither a complaint nor "later"
      'Loud music all night',
      null,
    ]);
    expect(themes.praise).toEqual([
      { key: 'polite', label: 'Polite, helpful crew', count: 2 },
      { key: 'safe', label: 'Safe, careful driving', count: 1 },
      { key: 'clean', label: 'Clean bus', count: 1 },
    ]);
    expect(themes.complaints).toEqual([
      { key: 'unsafe', label: 'Speeding or unsafe driving', count: 3 },
      { key: 'late', label: 'Late or long stops', count: 1 },
      { key: 'noise', label: 'Loud music or noise', count: 1 },
    ]);
  });
});

describe('scorecard: operations', () => {
  // Bus X: full at 10 000; 40 L partial at 10 200; 60 L full at 10 400 → 400 km on 100 L = 4.0 km/l.
  //        50 L full at 10 650 → 250 km on 50 L = 5.0 km/l.
  // Bus Y: full at 5 000; 100 L full at 5 300 → 300 km on 100 L = 3.0 km/l.
  const fuel: ScoreFuel[] = [
    { vehicleId: 'X', filledAt: at('2026-09-01T00:00:00Z'), odometerKm: 10000, litres: 80, fullTank: true },
    { vehicleId: 'X', filledAt: at('2026-09-03T00:00:00Z'), odometerKm: 10200, litres: 40, fullTank: false },
    { vehicleId: 'X', filledAt: at('2026-09-05T00:00:00Z'), odometerKm: 10400, litres: 60, fullTank: true },
    { vehicleId: 'X', filledAt: at('2026-09-07T00:00:00Z'), odometerKm: 10650, litres: 50, fullTank: true },
    { vehicleId: 'Y', filledAt: at('2026-09-01T00:00:00Z'), odometerKm: 5000, litres: 90, fullTank: true },
    { vehicleId: 'Y', filledAt: at('2026-09-06T00:00:00Z'), odometerKm: 5300, litres: 100, fullTank: true },
  ];
  const trip = (id: string, driverId: string, start: number | null, end: number | null, status = 'COMPLETED'): ScoreTrip =>
    ({ id, vehicleId: 'X', driverId, status, startOdometerKm: start, endOdometerKm: end });
  // T1 (A) 300 km in the 4.0 stretch → 75 L.
  // T2 (B) 10 300–10 500 crosses the refill: 100 km at 4.0 (25 L) + 100 km at 5.0 (20 L).
  // T3 (A) 150 km at 5.0 → 30 L. T5 (A) has no odometer; T6 (A) was cancelled.
  const busTrips = [
    trip('T1', 'A', 10000, 10300), trip('T2', 'B', 10300, 10500), trip('T3', 'A', 10500, 10650),
    trip('T5', 'A', null, null), trip('T6', 'A', null, null, 'CANCELLED'),
  ];
  const tripsA = busTrips.filter((t) => t.driverId === 'A');

  it('measures full tank to full tank, counting partial fills', () => {
    expect(tankStretches(fuel)).toEqual([
      { vehicleId: 'X', startKm: 10000, endKm: 10400, litres: 100, kmPerLitre: 4 },
      { vehicleId: 'X', startKm: 10400, endKm: 10650, litres: 50, kmPerLitre: 5 },
      { vehicleId: 'Y', startKm: 5000, endKm: 5300, litres: 100, kmPerLitre: 3 },
    ]);
  });

  it("compares a driver's km/l with the same buses and the company", () => {
    const stretches = tankStretches(fuel);
    // A: 450 km on 105 L = 4.2857 → 4.29. Bus X, everyone: 650 km on 150 L = 4.33.
    // Ratio 4.29 / 4.33 = 0.9907 → 0.99. Company: 950 km on 250 L = 3.8.
    expect(fuelEconomy(tripsA, busTrips, stretches, stretches)).toEqual({
      kmPerLitre: 4.29, sameBusesKmPerLitre: 4.33, companyKmPerLitre: 3.8, ratio: 0.99,
      tripsMeasured: 2, tripsWithOdometer: 2,
    });
    // B: 200 km on 45 L = 4.44.
    expect(fuelEconomy(busTrips.filter((t) => t.driverId === 'B'), busTrips, stretches, stretches).kmPerLitre).toBe(4.44);
  });

  it('counts trips without cancelled ones, and kilometres from odometer readings', () => {
    expect(tripTotals(tripsA)).toEqual({ trips: 3, km: 450, tripsWithKm: 2 });
  });

  it('keeps accidents apart from breakdowns', () => {
    expect(incidentSummary([
      { kind: 'BREAKDOWN', severity: 'MAJOR', occurredAt: at('2026-09-02T00:00:00Z') },
      { kind: 'ACCIDENT', severity: 'CRITICAL', occurredAt: at('2026-09-04T00:00:00Z') },
    ])).toEqual({ total: 2, accidents: 1, breakdowns: 1, critical: 1, byKind: { BREAKDOWN: 1, ACCIDENT: 1 } });
  });

  it('suggests appraisal scores only where the data can speak', () => {
    const stretches = tankStretches(fuel);
    const s = suggestScores({
      passengers: passengerScores(driverA, company),
      comments: commentThemes(['not safe at all', 'overtaking on bends', 'rash driving']),
      incidents: incidentSummary([{ kind: 'ACCIDENT', severity: 'CRITICAL', occurredAt: at('2026-09-04T00:00:00Z') }]),
      fuel: fuelEconomy(tripsA, busTrips, stretches, stretches),
      trips: tripTotals(tripsA),
      companyTripsPerDriver: 3,
    });
    // Driving 4.81 → 5. Punctuality and staff have too few reviews: left for the owner.
    expect(s.driving.value).toBe(5);
    expect(s.punctuality).toEqual({ value: null, basis: 'Not enough reviews yet (4 gave a punctuality score)' });
    expect(s.conduct.value).toBeNull();
    // One accident → 3, and three complaints about unsafe driving take a point off → 2.
    expect(s.safety).toEqual({ value: 2, basis: '1 accident recorded; 3 passenger complaints about unsafe driving' });
    // Ratio 0.99 is at least 0.98 → 4.
    expect(s.vehicleCare.value).toBe(4);
    // 3 trips against a company average of 3 → 5.
    expect(s.attendance).toEqual({ value: 5, basis: '3 trips; the company average is 3 per driver' });
  });
});

describe('scorecard: leaderboard', () => {
  it('ranks only drivers with enough reviews, sharing a rank on equal scores', () => {
    const rows = rankDrivers([
      { driverId: 'A', adjusted: 4.39, reviews: 12, enough: true },
      { driverId: 'B', adjusted: 4.9, reviews: 3, enough: false },
      { driverId: 'D', adjusted: 4.39, reviews: 15, enough: true },
      { driverId: 'E', adjusted: 4.0, reviews: 30, enough: true },
      { driverId: 'F', adjusted: null, reviews: 0, enough: false },
    ]);
    expect(rows.map((r) => [r.driverId, r.rank])).toEqual([['D', 1], ['A', 1], ['E', 3], ['B', null], ['F', null]]);
  });
});

describe('appraisal PDF text', () => {
  it('splits mixed English and Nepali so each script gets its own font file', () => {
    expect(scriptRuns('Safe driver, सुरक्षित चालक (5)')).toEqual([
      { text: 'Safe driver, ', ne: false },
      { text: 'सुरक्षित चालक ', ne: true },
      { text: '(5)', ne: false },
    ]);
  });
});
