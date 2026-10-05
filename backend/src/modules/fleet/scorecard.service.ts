import { Injectable, NotFoundException } from '@nestjs/common';
import { DriverRole, ModerationStatus, TripStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { adToBs, formatBs } from '../../common/utils/bs-date';
import { kathmanduPeriod, Period } from '../../common/utils/ktm-period';
import { FleetAccessService } from './fleet-access.service';
import { DAY_MS, expiry, round1 } from './fleet.util';
import {
  MIN_REVIEWS, PRIOR_WEIGHT, ScoreReview, ScoreTrip, ScorecardSummary, TankStretch, commentThemes, fuelEconomy,
  incidentSummary, monthlyTrend, passengerScores, rankDrivers, suggestScores, tankStretches, tripTotals,
} from './scorecard';

/** The reviews, trips, fuel and incidents of one company over one period, loaded once. */
interface CompanyData {
  period: Period;
  reviews: Array<ScoreReview & { driverId: string | null; conductorId: string | null }>;
  trips: Array<ScoreTrip & { conductorId: string | null; helperId: string | null }>;
  stretches: TankStretch[];
  companyStretches: TankStretch[];
  incidents: Array<{ driverId: string | null; kind: string; severity: string; occurredAt: Date }>;
  tripsPerDriver: number | null;
}

@Injectable()
export class ScorecardService {
  constructor(private prisma: PrismaService, private access: FleetAccessService) {}

  /** From and to are Kathmandu days, both included. Without them: the last 90 days. */
  period(fromDay?: string, toDay?: string): Period {
    return kathmanduPeriod(fromDay, toDay, { defaultDays: 90, maxDays: 731 });
  }

  private async load(operatorId: string, period: Period): Promise<CompanyData> {
    const { from, to } = period;
    // Fuel a little either side, so a trip near the period's edge still falls in a measured tank.
    const fuelFrom = new Date(from.getTime() - 45 * DAY_MS);
    const fuelTo = new Date(to.getTime() + 45 * DAY_MS);
    const [reviews, trips, fuel, incidents] = await Promise.all([
      this.prisma.rideFeedback.findMany({
        where: { vehicle: { operatorId }, moderation: ModerationStatus.APPROVED, createdAt: { gte: from, lt: to } },
        select: {
          createdAt: true, overall: true, driving: true, punctuality: true, staff: true,
          comment: true, suggestion: true, tripId: true, driverId: true, conductorId: true,
        },
      }),
      this.prisma.trip.findMany({
        where: { operatorId, departAt: { gte: from, lt: to } },
        select: {
          id: true, vehicleId: true, driverId: true, conductorId: true, helperId: true, status: true,
          startOdometerKm: true, endOdometerKm: true,
        },
      }),
      this.prisma.fuelLog.findMany({
        where: { vehicle: { operatorId }, filledAt: { gte: fuelFrom, lt: fuelTo } },
        select: { vehicleId: true, filledAt: true, odometerKm: true, litres: true, fullTank: true },
      }),
      this.prisma.busIncident.findMany({
        where: { vehicle: { operatorId }, occurredAt: { gte: from, lt: to } },
        select: { driverId: true, kind: true, severity: true, occurredAt: true },
      }),
    ]);
    const driven = trips.filter((t) => t.status !== TripStatus.CANCELLED && t.driverId);
    const drivers = new Set(driven.map((t) => t.driverId));
    return {
      period, reviews, trips, incidents,
      stretches: tankStretches(fuel),
      // The company figure uses only tanks filled full to full inside the period.
      companyStretches: tankStretches(fuel.filter((f) => f.filledAt >= from && f.filledAt < to)),
      tripsPerDriver: drivers.size ? round1(driven.length / drivers.size) : null,
    };
  }

  /** One crew member's card. Drivers are judged on trips they drove; conductors and helpers on theirs. */
  private card(data: CompanyData, person: { id: string; role: DriverRole }) {
    const isDriver = person.role === DriverRole.DRIVER;
    const reviews = data.reviews.filter((r) => (isDriver ? r.driverId : r.conductorId) === person.id);
    const trips = data.trips.filter((t) =>
      person.role === DriverRole.DRIVER ? t.driverId === person.id
        : person.role === DriverRole.CONDUCTOR ? t.conductorId === person.id
        : t.helperId === person.id);
    const buses = new Set(trips.map((t) => t.vehicleId));
    const summary: ScorecardSummary = {
      passengers: passengerScores(reviews, data.reviews),
      comments: commentThemes(reviews.map((r) => [r.comment, r.suggestion].filter(Boolean).join('\n'))),
      incidents: incidentSummary(data.incidents.filter((i) => i.driverId === person.id)),
      // Fuel is the driver's alone; a conductor does not press the pedal.
      fuel: fuelEconomy(isDriver ? trips : [], data.trips.filter((t) => buses.has(t.vehicleId)), data.stretches, data.companyStretches),
      trips: tripTotals(trips),
      companyTripsPerDriver: isDriver ? data.tripsPerDriver : null,
    };
    return { summary, trend: monthlyTrend(reviews), suggestions: suggestScores(summary) };
  }

  private periodView(p: Period) {
    return {
      from: p.fromDay, to: p.toDay,
      fromBs: formatBs(p.fromDay), toBs: formatBs(p.toDay),
      fromBsNe: formatBs(p.fromDay, 'ne'), toBsNe: formatBs(p.toDay, 'ne'),
    };
  }

  async driverFor(driverId: string, userId: string, level: 'VIEW' | 'MANAGE' | 'OWN' = 'VIEW') {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { id: true, operatorId: true, name: true, role: true, isActive: true, licenceExpiresAt: true },
    });
    if (!driver) throw new NotFoundException('Crew member not found');
    await this.access.company(driver.operatorId, userId, level);
    return driver;
  }

  /** The scorecard as the service and the appraisal both use it, for an already-checked driver. */
  async compute(driver: { id: string; operatorId: string; name: string; role: DriverRole; isActive: boolean; licenceExpiresAt: Date | null }, period: Period) {
    const data = await this.load(driver.operatorId, period);
    const { summary, trend, suggestions } = this.card(data, driver);
    return {
      driver: {
        id: driver.id, name: driver.name, role: driver.role, isActive: driver.isActive,
        licence: { expiresAt: driver.licenceExpiresAt, ...expiry(driver.licenceExpiresAt) },
      },
      period: this.periodView(period),
      ...summary,
      trend: trend.map((m) => ({ ...m, bs: monthBs(m.month) })),
      suggestions,
      method: {
        priorWeight: PRIOR_WEIGHT, minReviews: MIN_REVIEWS,
        notes: [
          `Passenger scores are pulled towards the company average by ${PRIOR_WEIGHT} reviews' worth, so a handful of reviews cannot make or break anyone.`,
          `Below ${MIN_REVIEWS} reviews there is no score to judge on.`,
          'Only reviews passed by moderation count. Reviewers are never named, to the company or the driver.',
          'Fuel is measured from one full tank to the next. Drivers who share a tank share its figure.',
        ],
      },
    };
  }

  async scorecard(driverId: string, fromDay: string | undefined, toDay: string | undefined, userId: string) {
    const driver = await this.driverFor(driverId, userId);
    return this.compute(driver, this.period(fromDay, toDay));
  }

  /** Every driver in the company, ranked where the reviews allow it. Owners only. */
  async leaderboard(operatorId: string, fromDay: string | undefined, toDay: string | undefined, userId: string) {
    await this.access.company(operatorId, userId, 'OWN');
    const period = this.period(fromDay, toDay);
    const [data, drivers] = await Promise.all([
      this.load(operatorId, period),
      this.prisma.driver.findMany({
        where: { operatorId, role: DriverRole.DRIVER },
        select: { id: true, name: true, isActive: true, role: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const rows = drivers
      .map((d) => {
        const { summary } = this.card(data, d);
        const overall = summary.passengers.scores.overall;
        return {
          driverId: d.id, name: d.name, isActive: d.isActive,
          adjusted: overall.adjusted, mean: overall.mean, reviews: overall.n, enough: overall.enough,
          driving: summary.passengers.scores.driving.adjusted,
          trips: summary.trips.trips, km: summary.trips.km,
          kmPerLitre: summary.fuel.kmPerLitre, accidents: summary.incidents.accidents,
        };
      })
      // A driver who has left and did nothing in the period is not part of this picture.
      .filter((r) => r.isActive || r.reviews > 0 || r.trips > 0);
    const companyOverall = data.reviews.length
      ? round1(data.reviews.reduce((n, r) => n + r.overall, 0) / data.reviews.length) : null;
    return {
      period: this.periodView(period),
      companyOverall,
      caveat: `Drivers with fewer than ${MIN_REVIEWS} reviews are listed but not ranked. Scores are adjusted towards the company average, so a few reviews cannot put anyone at the top or the bottom. Use this to start a conversation, not to end one.`,
      rows: rankDrivers(rows),
    };
  }
}

/** "Asoj–Kartik 2083": a Gregorian month spans two Nepali months. */
function monthBs(month: string) {
  const first = adToBs(`${month}-01`);
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = adToBs(`${month}-${String(lastDay).padStart(2, '0')}`);
  if (!first || !last) return null;
  const a = formatBs(`${month}-01`).split(' ');
  const b = formatBs(`${month}-${String(lastDay).padStart(2, '0')}`).split(' ');
  // formatBs gives "17 Asoj 2082": month is the middle word, year the last.
  return a[2] === b[2] ? `${a[1]}–${b[1]} ${b[2]}` : `${a[1]} ${a[2]} – ${b[1]} ${b[2]}`;
}
