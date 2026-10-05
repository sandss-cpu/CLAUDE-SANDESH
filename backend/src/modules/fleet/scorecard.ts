/**
 * Driver scorecards: pure functions over rows the service has already loaded, so every
 * figure can be checked by hand (scorecard.spec.ts does exactly that).
 *
 * Fairness rules, from the brief:
 * - Passenger scores are a Bayesian average: a driver with three five-star reviews is not
 *   ranked above one with forty reviews averaging 4.6. Each driver's mean is pulled
 *   towards the company's mean by PRIOR_WEIGHT imaginary reviews.
 * - Under MIN_REVIEWS reviews there is no score to rank on: "Not enough reviews yet".
 * - Fuel is measured per tank, not per trip. Where two drivers share a tank between
 *   full fills, they share its figure; the scorecard says how many trips it rests on.
 */
import { kathmanduDay } from '../../common/utils/bs-date';

export const PRIOR_WEIGHT = 10;
export const MIN_REVIEWS = 10;
export const NOT_ENOUGH = 'Not enough reviews yet';

export type Metric = 'overall' | 'driving' | 'punctuality' | 'staff';
export const METRICS: Metric[] = ['overall', 'driving', 'punctuality', 'staff'];

export interface ScoreReview {
  createdAt: Date;
  overall: number;
  driving: number | null;
  punctuality: number | null;
  staff: number | null;
  comment: string | null;
  suggestion: string | null;
  tripId: string | null;
}

export interface MetricScore {
  /** Reviews that gave this score (part scores are optional, so each has its own count). */
  n: number;
  mean: number | null;
  adjusted: number | null;
  companyMean: number | null;
  enough: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** (C × prior + sum) / (C + n). With no company prior, the plain mean. */
export function bayesian(sum: number, n: number, prior: number | null, weight = PRIOR_WEIGHT): number | null {
  if (n === 0) return null;
  if (prior == null) return round2(sum / n);
  return round2((weight * prior + sum) / (weight + n));
}

function values(reviews: ScoreReview[], metric: Metric): number[] {
  return reviews.map((r) => r[metric]).filter((v): v is number => typeof v === 'number');
}

const mean = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Every passenger score for one driver, adjusted against the company's reviews over the same period. */
export function passengerScores(driver: ScoreReview[], company: ScoreReview[]) {
  const scores = {} as Record<Metric, MetricScore>;
  for (const metric of METRICS) {
    const own = values(driver, metric);
    const all = values(company, metric);
    const companyMean = mean(all);
    const sum = own.reduce((a, b) => a + b, 0);
    scores[metric] = {
      n: own.length,
      mean: mean(own),
      adjusted: bayesian(sum, own.length, companyMean),
      companyMean,
      enough: own.length >= MIN_REVIEWS,
    };
  }
  return {
    reviews: driver.length,
    fromTrips: driver.filter((r) => r.tripId).length,
    enough: driver.length >= MIN_REVIEWS,
    label: driver.length >= MIN_REVIEWS ? null : NOT_ENOUGH,
    scores,
  };
}

/** Reviews and the plain average overall score per calendar month, in Kathmandu time, oldest first. */
export function monthlyTrend(reviews: ScoreReview[]) {
  const months = new Map<string, number[]>();
  for (const r of reviews) {
    const month = kathmanduDay(r.createdAt).slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), r.overall]);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, scores]) => ({ month, reviews: scores.length, overall: mean(scores) }));
}

// ---------------------------------------------------------------- comments

interface Theme {
  key: string;
  label: string;
  /** English words, matched whole; a trailing * makes it a stem ("overtak*" finds "overtaking"). */
  en: string[];
  /** Nepali words, matched anywhere: Devanagari has no reliable word boundary in a regex. */
  ne: string[];
  /** For praise: the complaint a negated mention ("not safe") counts towards. */
  opposite?: string;
}

const PRAISE: Theme[] = [
  { key: 'safe', label: 'Safe, careful driving', en: ['safe', 'safely', 'careful*', 'smooth*', 'steady', 'calm'], ne: ['सुरक्षित', 'होसियार', 'सावधान', 'बिस्तारै'], opposite: 'unsafe' },
  { key: 'polite', label: 'Polite, helpful crew', en: ['polite*', 'friendly', 'helpful', 'kind', 'respectful', 'courteous'], ne: ['विनम्र', 'सहयोगी', 'मिलनसार', 'राम्रो व्यवहार'], opposite: 'rude' },
  { key: 'punctual', label: 'On time', en: ['punctual*', 'on time', 'on-time'], ne: ['समयमै', 'समयमा'], opposite: 'late' },
  { key: 'clean', label: 'Clean bus', en: ['clean', 'tidy'], ne: ['सफा'], opposite: 'dirty' },
  { key: 'comfortable', label: 'Comfortable', en: ['comfortable', 'comfy'], ne: ['आरामदायी'] },
];

const COMPLAINTS: Theme[] = [
  { key: 'unsafe', label: 'Speeding or unsafe driving', en: ['speeding', 'too fast', 'rash', 'reckless*', 'dangerous*', 'overtak*', 'unsafe'], ne: ['तीव्र गति', 'धेरै छिटो', 'लापरवाह', 'खतरनाक', 'ओभरटेक'] },
  { key: 'rude', label: 'Rude crew', en: ['rude*', 'shout*', 'abusive', 'insult*', 'misbehav*'], ne: ['रुखो', 'असभ्य', 'गाली', 'कराउ'] },
  { key: 'late', label: 'Late or long stops', en: ['late', 'delay*', 'waited', 'long stop*'], ne: ['ढिलो', 'ढिला', 'पर्खा'] },
  { key: 'dirty', label: 'Dirty bus', en: ['dirty', 'smelly', 'filthy', 'unclean'], ne: ['फोहोर', 'गन्हा'] },
  { key: 'noise', label: 'Loud music or noise', en: ['loud*', 'noisy'], ne: ['चर्को', 'हल्ला'] },
  { key: 'smoking', label: 'Smoking or drinking', en: ['smok*', 'cigarette*', 'drunk', 'alcohol', 'drinking'], ne: ['धुम्रपान', 'चुरोट', 'रक्सी', 'मातेको'] },
  { key: 'phone', label: 'On the phone while driving', en: ['on the phone', 'on his phone', 'on her phone', 'on phone', 'mobile while'], ne: ['मोबाइल', 'फोनमा'] },
  { key: 'fare', label: 'Overcharging', en: ['overcharg*', 'extra fare', 'extra money', 'charged more'], ne: ['बढी भाडा', 'धेरै भाडा'] },
];

const NEGATION = /\b(not|never|no|isn't|wasn't|weren't|wasnt|isnt|didn't|didnt|hardly)\s+(?:\w+\s+){0,1}$/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where a theme is mentioned: each match's index, and whether it was negated ("not safe"). */
function mentions(text: string, theme: Theme): Array<{ negated: boolean }> {
  const found: Array<{ negated: boolean }> = [];
  for (const word of theme.en) {
    const stem = word.endsWith('*');
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(stem ? word.slice(0, -1) : word)}${stem ? '' : '(?![\\p{L}])'}`, 'giu');
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index! - 24), m.index! + m[1].length);
      found.push({ negated: NEGATION.test(before) });
    }
  }
  for (const word of theme.ne) {
    let at = text.indexOf(word);
    while (at >= 0) {
      // Nepali negation is mostly a suffix or a following word (नभएको, होइन, छैन).
      const after = text.slice(at + word.length, at + word.length + 8);
      found.push({ negated: /^\s*(न|छैन|होइन|थिएन)/.test(after) });
      at = text.indexOf(word, at + word.length);
    }
  }
  return found;
}

/**
 * Praise and complaint themes in what passengers wrote, counted once per review. A
 * negated mention of praise ("not safe at all") counts as the matching complaint.
 */
export function commentThemes(texts: Array<string | null | undefined>) {
  const praise = new Map<string, number>();
  const complaints = new Map<string, number>();
  for (const raw of texts) {
    if (!raw) continue;
    const text = raw.toLowerCase();
    const hitPraise = new Set<string>();
    const hitComplaint = new Set<string>();
    for (const theme of PRAISE) {
      for (const m of mentions(text, theme)) {
        if (!m.negated) hitPraise.add(theme.key);
        else if (theme.opposite) hitComplaint.add(theme.opposite);
      }
    }
    for (const theme of COMPLAINTS) {
      // "not late" is not a complaint about lateness.
      if (mentions(text, theme).some((m) => !m.negated)) hitComplaint.add(theme.key);
    }
    hitPraise.forEach((k) => praise.set(k, (praise.get(k) ?? 0) + 1));
    hitComplaint.forEach((k) => complaints.set(k, (complaints.get(k) ?? 0) + 1));
  }
  const list = (counts: Map<string, number>, themes: Theme[]) => themes
    .filter((t) => counts.get(t.key))
    .map((t) => ({ key: t.key, label: t.label, count: counts.get(t.key)! }))
    .sort((a, b) => b.count - a.count);
  return { praise: list(praise, PRAISE), complaints: list(complaints, COMPLAINTS) };
}

// ---------------------------------------------------------------- operations

export interface ScoreIncident { kind: string; severity: string; occurredAt: Date }

/** Accidents are counted apart from breakdowns: a flat tyre says little about the driver. */
export function incidentSummary(incidents: ScoreIncident[]) {
  const byKind: Record<string, number> = {};
  for (const i of incidents) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const accidents = incidents.filter((i) => i.kind === 'ACCIDENT').length;
  return {
    total: incidents.length,
    accidents,
    breakdowns: incidents.length - accidents,
    critical: incidents.filter((i) => i.severity === 'CRITICAL').length,
    byKind,
  };
}

export interface ScoreTrip {
  id: string;
  vehicleId: string;
  driverId: string | null;
  status: string;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
}

export interface ScoreFuel { vehicleId: string; filledAt: Date; odometerKm: number; litres: number; fullTank: boolean }

export interface TankStretch { vehicleId: string; startKm: number; endKm: number; litres: number; kmPerLitre: number }

/**
 * Full-to-full tank stretches for each bus, by odometer: the litres of every fill after
 * one full tank, up to and including the next, burnt over the kilometres between them.
 * The same rule as `mileage()` in fleet.util, kept per stretch so trips can be placed in one.
 */
export function tankStretches(fuel: ScoreFuel[]): TankStretch[] {
  const byBus = new Map<string, ScoreFuel[]>();
  for (const f of fuel) byBus.set(f.vehicleId, [...(byBus.get(f.vehicleId) ?? []), f]);
  const stretches: TankStretch[] = [];
  for (const [vehicleId, logs] of byBus) {
    logs.sort((a, b) => a.odometerKm - b.odometerKm || a.filledAt.getTime() - b.filledAt.getTime());
    let lastFull: ScoreFuel | null = null;
    let litres = 0;
    for (const log of logs) {
      if (lastFull) litres += log.litres;
      if (!log.fullTank) continue;
      if (lastFull) {
        const km = log.odometerKm - lastFull.odometerKm;
        if (km > 0 && litres > 0) {
          stretches.push({ vehicleId, startKm: lastFull.odometerKm, endKm: log.odometerKm, litres: round2(litres), kmPerLitre: round2(km / litres) });
        }
      }
      lastFull = log;
      litres = 0;
    }
  }
  return stretches;
}

const tripKm = (t: ScoreTrip) =>
  t.startOdometerKm != null && t.endOdometerKm != null && t.endOdometerKm > t.startOdometerKm ? t.endOdometerKm - t.startOdometerKm : null;

/** Kilometres and litres a set of trips used, from the stretches their odometer readings fall in. */
function fuelFor(trips: ScoreTrip[], stretches: TankStretch[]) {
  let km = 0;
  let litres = 0;
  let measured = 0;
  for (const t of trips) {
    if (tripKm(t) == null) continue;
    let tripMeasured = 0;
    for (const s of stretches) {
      if (s.vehicleId !== t.vehicleId) continue;
      const overlap = Math.min(s.endKm, t.endOdometerKm!) - Math.max(s.startKm, t.startOdometerKm!);
      if (overlap <= 0) continue;
      km += overlap;
      litres += overlap / s.kmPerLitre;
      tripMeasured += overlap;
    }
    if (tripMeasured > 0) measured += 1;
  }
  return { km, litres, measured };
}

/**
 * The driver's km/l on their own trips, the same buses' km/l with anyone driving, and the
 * whole company's. Comparing with the same buses is the fair one: a minibus and a
 * full-size coach burn very differently whoever drives.
 */
export function fuelEconomy(driverTrips: ScoreTrip[], busTrips: ScoreTrip[], stretches: TankStretch[], companyStretches: TankStretch[]) {
  const own = fuelFor(driverTrips, stretches);
  const buses = fuelFor(busTrips, stretches);
  const companyKm = companyStretches.reduce((n, s) => n + (s.endKm - s.startKm), 0);
  const companyLitres = companyStretches.reduce((n, s) => n + s.litres, 0);
  const kmPerLitre = own.litres > 0 ? round2(own.km / own.litres) : null;
  const sameBusesKmPerLitre = buses.litres > 0 ? round2(buses.km / buses.litres) : null;
  return {
    kmPerLitre,
    sameBusesKmPerLitre,
    companyKmPerLitre: companyLitres > 0 ? round2(companyKm / companyLitres) : null,
    /** Driver ÷ same buses: above 1 means less fuel than others on those buses. */
    ratio: kmPerLitre != null && sameBusesKmPerLitre ? round2(kmPerLitre / sameBusesKmPerLitre) : null,
    tripsMeasured: own.measured,
    tripsWithOdometer: driverTrips.filter((t) => tripKm(t) != null).length,
  };
}

/** Trips driven (cancelled ones do not count) and the kilometres the odometer readings show. */
export function tripTotals(trips: ScoreTrip[]) {
  const counted = trips.filter((t) => t.status !== 'CANCELLED');
  const withKm = counted.map(tripKm).filter((k): k is number => k != null);
  return { trips: counted.length, km: withKm.reduce((a, b) => a + b, 0), tripsWithKm: withKm.length };
}

// ---------------------------------------------------------------- appraisal suggestions

export type Criterion = 'driving' | 'punctuality' | 'conduct' | 'safety' | 'vehicleCare' | 'attendance';
export const CRITERIA: Criterion[] = ['driving', 'punctuality', 'conduct', 'safety', 'vehicleCare', 'attendance'];
export interface Suggestion { value: number | null; basis: string }

const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));

function fromPassengers(score: MetricScore, what: string): Suggestion {
  if (!score.enough || score.adjusted == null) {
    return { value: null, basis: `${NOT_ENOUGH} (${score.n} gave a ${what} score)` };
  }
  return { value: clamp(score.adjusted), basis: `${score.adjusted.toFixed(1)}★ for ${what} from ${score.n} reviews, adjusted for the company average` };
}

export interface ScorecardSummary {
  passengers: ReturnType<typeof passengerScores>;
  comments: ReturnType<typeof commentThemes>;
  incidents: ReturnType<typeof incidentSummary>;
  fuel: ReturnType<typeof fuelEconomy>;
  trips: ReturnType<typeof tripTotals>;
  /** The company's average trips per driver who drove in the period. */
  companyTripsPerDriver: number | null;
}

/**
 * What the data suggests for each appraisal criterion. The owner confirms or changes
 * every one; a criterion the data cannot speak to is left empty, never guessed.
 */
export function suggestScores(card: ScorecardSummary): Record<Criterion, Suggestion> {
  const { passengers, comments, incidents, fuel, trips, companyTripsPerDriver } = card;

  const unsafe = comments.complaints.find((c) => c.key === 'unsafe')?.count ?? 0;
  const accidentScore = incidents.accidents === 0 ? 5 : incidents.accidents === 1 ? 3 : 1;
  // Repeated passenger complaints about speeding take a point off, even with no accident.
  const safety = clamp(accidentScore - (unsafe >= 3 ? 1 : 0));
  const safetyBasis = [
    incidents.accidents === 0 ? 'No accidents recorded' : `${incidents.accidents} ${incidents.accidents === 1 ? 'accident' : 'accidents'} recorded`,
    unsafe ? `${unsafe} passenger ${unsafe === 1 ? 'complaint' : 'complaints'} about unsafe driving` : null,
  ].filter(Boolean).join('; ');

  let vehicleCare: Suggestion = { value: null, basis: 'No fuel figures: trips need odometer readings and full-tank fills' };
  if (fuel.ratio != null) {
    const r = fuel.ratio;
    vehicleCare = {
      value: r >= 1.05 ? 5 : r >= 0.98 ? 4 : r >= 0.92 ? 3 : r >= 0.85 ? 2 : 1,
      basis: `${fuel.kmPerLitre} km/l against ${fuel.sameBusesKmPerLitre} km/l on the same buses (${fuel.tripsMeasured} trips measured)`,
    };
  }

  let attendance: Suggestion = { value: null, basis: 'No trips logged in this period' };
  if (companyTripsPerDriver && companyTripsPerDriver > 0) {
    const r = trips.trips / companyTripsPerDriver;
    attendance = {
      value: r >= 0.9 ? 5 : r >= 0.75 ? 4 : r >= 0.6 ? 3 : r >= 0.4 ? 2 : 1,
      basis: `${trips.trips} trips; the company average is ${companyTripsPerDriver} per driver`,
    };
  }

  return {
    driving: fromPassengers(passengers.scores.driving, 'driving'),
    punctuality: fromPassengers(passengers.scores.punctuality, 'punctuality'),
    conduct: fromPassengers(passengers.scores.staff, 'staff'),
    safety: { value: safety, basis: safetyBasis },
    vehicleCare,
    attendance,
  };
}

// ---------------------------------------------------------------- leaderboard

export interface LeaderRow { driverId: string; adjusted: number | null; reviews: number; enough: boolean }

/**
 * Ranks drivers with enough reviews by adjusted overall score; everyone else is listed
 * after them, unranked, so a new driver is never shown as "last".
 */
export function rankDrivers<T extends LeaderRow>(rows: T[]): Array<T & { rank: number | null }> {
  const ranked = rows
    .filter((r) => r.enough && r.adjusted != null)
    .sort((a, b) => b.adjusted! - a.adjusted! || b.reviews - a.reviews);
  const out: Array<T & { rank: number | null }> = [];
  ranked.forEach((r, i) => {
    // Equal scores share a rank.
    const prev = out[i - 1];
    out.push({ ...r, rank: prev && prev.adjusted === r.adjusted ? prev.rank : i + 1 });
  });
  const rest = rows.filter((r) => !(r.enough && r.adjusted != null)).sort((a, b) => b.reviews - a.reviews);
  return [...out, ...rest.map((r) => ({ ...r, rank: null }))];
}
