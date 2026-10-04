import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverRole, Prisma, TripSource, TripStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { FleetAccessService } from './fleet-access.service';
import { EndTripDto, StartTripDto, TripListQueryDto, UnlockTripDto, UpdateTripDto } from './dto/fleet.dto';

const HOUR = 3_600_000;
/** Owners and managers can correct a trip for this long after it departed. */
const EDIT_WINDOW_MS = 48 * HOUR;
/** How long an owner's reopening lasts. */
const UNLOCK_MS = 24 * HOUR;
/**
 * A trip nobody ended stops counting as "on the road" after this. Without it, one
 * forgotten "End trip" would attribute every later review to that driver forever.
 */
const OPEN_TRIP_LIMIT_MS = 24 * HOUR;
/** A trip can be logged late, but not before the bus could have left or long in advance. */
const LATE_LOGGING_MS = 48 * HOUR;
const EARLY_LOGGING_MS = 1 * HOUR;
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60_000;
const PAGE = 50;

const CREW_SELECT = { select: { id: true, name: true, role: true } } as const;
const TRIP_INCLUDE = {
  vehicle: { select: { id: true, plateNo: true, label: true } },
  route: { select: { id: true, name: true, startPlace: true, endPlace: true, distanceKm: true } },
  driver: CREW_SELECT, conductor: CREW_SELECT, helper: CREW_SELECT,
  _count: { select: { reviews: true } },
} satisfies Prisma.TripInclude;

type TripRow = Prisma.TripGetPayload<{ include: typeof TRIP_INCLUDE }>;

/** Midnight at the start of a Kathmandu calendar day, as an instant. */
const kathmanduMidnight = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - KATHMANDU_OFFSET_MS);
};

export const isLocked = (t: { departAt: Date; unlockedUntil: Date | null }, now = new Date()) =>
  now.getTime() > t.departAt.getTime() + EDIT_WINDOW_MS && !(t.unlockedUntil && t.unlockedUntil > now);

/**
 * The duty log: which bus ran which way, when, and with whom. It is the fact that
 * turns a bus's reviews into a driver's, so changing it is audited and, after 48 hours,
 * needs the owner to reopen it with a reason.
 */
@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private access: FleetAccessService,
    private audit: AuditService,
  ) {}

  // ================= reading =================

  /**
   * The duty screen: every running bus with its trip in progress, if any, and the crew
   * assigned to it, so starting a trip is "pick the bus, confirm".
   */
  async duty(operatorId: string, userId: string) {
    const { operator, role } = await this.access.company(operatorId, userId, 'DUTY');
    const since = new Date(Date.now() - OPEN_TRIP_LIMIT_MS);
    const buses = await this.prisma.vehicle.findMany({
      where: { operatorId, isActive: true },
      orderBy: { plateNo: 'asc' },
      select: {
        id: true, plateNo: true, label: true, odometerKm: true,
        route: { select: { id: true, name: true, startPlace: true, endPlace: true } },
        assignments: { where: { endedAt: null }, select: { driver: CREW_SELECT } },
        trips: {
          where: { status: TripStatus.IN_PROGRESS },
          include: { driver: CREW_SELECT, conductor: CREW_SELECT, helper: CREW_SELECT },
          take: 1,
        },
      },
    });
    return {
      company: { id: operator.id, name: operator.name },
      role,
      buses: buses.map(({ assignments, trips, ...bus }) => {
        const trip = trips[0];
        return {
          ...bus,
          crew: assignments.map((a) => a.driver),
          trip: trip && {
            id: trip.id, direction: trip.direction, departAt: trip.departAt, status: trip.status,
            driver: trip.driver, conductor: trip.conductor, helper: trip.helper,
            // Older than a day and never ended: shown as forgotten, and no longer counted.
            stale: trip.departAt < since,
          },
        };
      }),
    };
  }

  async list(operatorId: string, q: TripListQueryDto, userId: string) {
    await this.access.company(operatorId, userId, 'VIEW');
    const page = q.page ?? 1;
    const where: Prisma.TripWhereInput = {
      operatorId,
      ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
      ...(q.driverId ? { OR: [{ driverId: q.driverId }, { conductorId: q.driverId }, { helperId: q.driverId }] } : {}),
      ...(q.status ? { status: q.status } : {}),
      departAt: {
        ...(q.from ? { gte: kathmanduMidnight(q.from) } : {}),
        ...(q.to ? { lt: new Date(kathmanduMidnight(q.to).getTime() + 24 * HOUR) } : {}),
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.trip.findMany({ where, include: TRIP_INCLUDE, orderBy: { departAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.trip.count({ where }),
    ]);
    return { items: items.map((t) => this.view(t)), total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
  }

  async one(id: string, userId: string) {
    const trip = await this.tripFor(id, userId, 'VIEW');
    return this.view(trip);
  }

  // ================= writing =================

  async start(vehicleId: string, dto: StartTripDto, userId: string, ip?: string) {
    const { bus } = await this.access.bus(vehicleId, userId, 'DUTY');
    if (!bus.isActive) throw new BadRequestException('This bus is archived. Restore it before starting a trip.');
    if (!bus.routeId) throw new BadRequestException('Give this bus a route in the portal before starting a trip.');

    const now = Date.now();
    const departAt = dto.departAt ? new Date(dto.departAt) : new Date(now);
    if (departAt.getTime() > now + EARLY_LOGGING_MS) throw new BadRequestException('A trip can only be started up to an hour ahead.');
    if (departAt.getTime() < now - LATE_LOGGING_MS) throw new BadRequestException('Trips more than two days old are added by the owner, not started.');

    const running = await this.prisma.trip.findFirst({
      where: { vehicleId, status: TripStatus.IN_PROGRESS }, select: { id: true, departAt: true },
    });
    if (running) {
      throw new ConflictException({
        code: 'TRIP_IN_PROGRESS', tripId: running.id,
        message: 'This bus is still on a trip. End that one first.',
      });
    }

    const chosen = [dto.driverId, dto.conductorId, dto.helperId].some(Boolean);
    const crew = chosen
      ? await this.checkedCrew(bus.operatorId, dto)
      : await this.assignedCrew(vehicleId);

    try {
      const trip = await this.prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            operatorId: bus.operatorId, vehicleId, routeId: bus.routeId, direction: dto.direction, departAt,
            ...crew, source: chosen ? TripSource.MANUAL : TripSource.ASSIGNMENT_DEFAULT,
            startOdometerKm: dto.startOdometerKm ?? null, createdById: userId,
          },
          include: TRIP_INCLUDE,
        });
        await this.audit.record({
          actorId: userId, ip, action: 'trip.start', entityType: 'Trip', entityId: created.id,
          summary: `Started a trip: ${created.vehicle.plateNo} towards ${this.towards(created)}`,
          after: created, routeId: created.routeId, operatorId: created.operatorId,
        }, tx);
        return created;
      });
      return this.view(trip);
    } catch (e) {
      // Two phones starting the same bus at once: trip_one_in_progress lets only one through.
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        throw new ConflictException({ code: 'TRIP_IN_PROGRESS', message: 'This bus is still on a trip. End that one first.' });
      }
      throw e;
    }
  }

  async end(id: string, dto: EndTripDto, userId: string, ip?: string) {
    const trip = await this.tripFor(id, userId, 'DUTY');
    if (trip.status !== TripStatus.IN_PROGRESS) throw new BadRequestException('This trip has already ended.');
    const arriveAt = dto.arriveAt ? new Date(dto.arriveAt) : new Date();
    if (arriveAt <= trip.departAt) throw new BadRequestException('Arrival must be after departure.');
    if (arriveAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Arrival cannot be in the future.');
    if (dto.endOdometerKm != null && trip.startOdometerKm != null && dto.endOdometerKm < trip.startOdometerKm) {
      throw new BadRequestException('The odometer reading at arrival is lower than at departure.');
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({
        where: { id },
        data: { status: TripStatus.COMPLETED, arriveAt, endOdometerKm: dto.endOdometerKm ?? undefined },
        include: TRIP_INCLUDE,
      });
      // The bus's own odometer drives service reminders; a higher reading moves it on.
      if (dto.endOdometerKm != null) {
        await tx.vehicle.updateMany({
          where: { id: trip.vehicleId, odometerKm: { lt: dto.endOdometerKm } }, data: { odometerKm: dto.endOdometerKm },
        });
      }
      await this.audit.record({
        actorId: userId, ip, action: 'trip.end', entityType: 'Trip', entityId: id,
        summary: `Ended the trip: ${updated.vehicle.plateNo} towards ${this.towards(updated)}`,
        before: this.plain(trip), after: updated, routeId: trip.routeId, operatorId: trip.operatorId,
      }, tx);
      return updated;
    });
    return this.view(after);
  }

  async update(id: string, dto: UpdateTripDto, userId: string, ip?: string) {
    const trip = await this.tripFor(id, userId, 'MANAGE');
    if (isLocked(trip)) {
      throw new ForbiddenException({
        code: 'TRIP_LOCKED',
        message: 'Trips lock 48 hours after departure. The owner can reopen it, with a reason.',
      });
    }

    const data: Prisma.TripUncheckedUpdateInput = {};
    if (dto.direction) data.direction = dto.direction;
    if (dto.departAt) data.departAt = new Date(dto.departAt);
    if (dto.arriveAt !== undefined) data.arriveAt = dto.arriveAt ? new Date(dto.arriveAt) : null;
    if (dto.startOdometerKm !== undefined) data.startOdometerKm = dto.startOdometerKm;
    if (dto.endOdometerKm !== undefined) data.endOdometerKm = dto.endOdometerKm;
    if (dto.status) data.status = dto.status;
    for (const key of ['driverId', 'conductorId', 'helperId'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.driverId || dto.conductorId || dto.helperId) {
      await this.checkedCrew(trip.operatorId, dto);
      data.source = TripSource.MANUAL;
    }
    // Completing needs an arrival; a completed trip cannot go back to running.
    const status = (data.status as TripStatus | undefined) ?? trip.status;
    const arriveAt = data.arriveAt !== undefined ? (data.arriveAt as Date | null) : trip.arriveAt;
    const departAt = (data.departAt as Date | undefined) ?? trip.departAt;
    if (status === TripStatus.COMPLETED && !arriveAt) throw new BadRequestException('Give the arrival time to complete a trip.');
    if (arriveAt && arriveAt <= departAt) throw new BadRequestException('Arrival must be after departure.');
    const start = data.startOdometerKm !== undefined ? (data.startOdometerKm as number | null) : trip.startOdometerKm;
    const end = data.endOdometerKm !== undefined ? (data.endOdometerKm as number | null) : trip.endOdometerKm;
    if (start != null && end != null && end < start) throw new BadRequestException('The odometer reading at arrival is lower than at departure.');

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({ where: { id }, data, include: TRIP_INCLUDE });
      await this.audit.record({
        actorId: userId, ip, action: status === TripStatus.CANCELLED ? 'trip.cancel' : 'trip.update',
        entityType: 'Trip', entityId: id,
        summary: `${status === TripStatus.CANCELLED ? 'Cancelled' : 'Corrected'} the trip: ${updated.vehicle.plateNo} on ${updated.departAt.toISOString().slice(0, 10)}`,
        before: this.plain(trip), after: updated, routeId: trip.routeId, operatorId: trip.operatorId,
      }, tx);
      return updated;
    });
    return this.view(after);
  }

  /** The owner reopens a locked trip for a day, and has to say why. */
  async unlock(id: string, dto: UnlockTripDto, userId: string, ip?: string) {
    const trip = await this.tripFor(id, userId, 'OWN');
    const unlockedUntil = new Date(Date.now() + UNLOCK_MS);
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({ where: { id }, data: { unlockedUntil, unlockReason: dto.reason }, include: TRIP_INCLUDE });
      await this.audit.record({
        actorId: userId, ip, action: 'trip.unlock', entityType: 'Trip', entityId: id,
        summary: `Reopened the trip ${updated.vehicle.plateNo} on ${updated.departAt.toISOString().slice(0, 10)}: ${dto.reason}`,
        before: this.plain(trip), after: updated, routeId: trip.routeId, operatorId: trip.operatorId,
      }, tx);
      return updated;
    });
    return this.view(after);
  }

  // ================= for reviews and the reader =================

  /**
   * Who was crewing this bus at a moment: the trip running then, else the crew assigned
   * to the bus then, else nobody. This is how a review reaches a driver; the passenger
   * never says who it was.
   */
  async crewAt(vehicleId: string, at: Date) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        vehicleId, status: { not: TripStatus.CANCELLED }, departAt: { lte: at },
        OR: [
          { arriveAt: { gte: at } },
          { arriveAt: null, departAt: { gte: new Date(at.getTime() - OPEN_TRIP_LIMIT_MS) } },
        ],
      },
      orderBy: { departAt: 'desc' },
      select: { id: true, driverId: true, conductorId: true },
    });
    if (trip) return { tripId: trip.id, driverId: trip.driverId, conductorId: trip.conductorId };

    const assigned = await this.prisma.driverAssignment.findMany({
      where: { vehicleId, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] },
      orderBy: { startedAt: 'desc' },
      select: { driverId: true, driver: { select: { role: true } } },
    });
    return {
      tripId: null,
      driverId: assigned.find((a) => a.driver.role === DriverRole.DRIVER)?.driverId ?? null,
      conductorId: assigned.find((a) => a.driver.role === DriverRole.CONDUCTOR)?.driverId ?? null,
    };
  }

  /** The direction of the trip this bus is on now, if any: it outranks a traveller's guess. */
  async directionNow(vehicleId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        vehicleId, status: TripStatus.IN_PROGRESS,
        departAt: { gte: new Date(Date.now() - OPEN_TRIP_LIMIT_MS), lte: new Date(Date.now() + EARLY_LOGGING_MS) },
      },
      select: { direction: true },
    });
    return trip?.direction === 'FORWARD' || trip?.direction === 'REVERSE' ? trip.direction : null;
  }

  // ================= helpers =================

  private async tripFor(id: string, userId: string, level: 'DUTY' | 'VIEW' | 'MANAGE' | 'OWN') {
    const trip = await this.prisma.trip.findUnique({ where: { id }, include: TRIP_INCLUDE });
    // Same answer whether the trip does not exist or belongs to another company.
    if (!trip) throw new NotFoundException('Trip not found');
    try {
      await this.access.company(trip.operatorId, userId, level);
    } catch (e) {
      if (e instanceof NotFoundException) throw new NotFoundException('Trip not found');
      throw e;
    }
    return trip;
  }

  /** Crew chosen by hand must be this company's, and still working for it. */
  private async checkedCrew(operatorId: string, dto: { driverId?: string | null; conductorId?: string | null; helperId?: string | null }) {
    const ids = [dto.driverId, dto.conductorId, dto.helperId].filter(Boolean) as string[];
    if (ids.length) {
      const found = await this.prisma.driver.count({ where: { id: { in: ids }, operatorId, isActive: true } });
      if (found !== new Set(ids).size) throw new BadRequestException('Choose active crew members from your company.');
    }
    return { driverId: dto.driverId ?? null, conductorId: dto.conductorId ?? null, helperId: dto.helperId ?? null };
  }

  /** Whoever is assigned to the bus now, by job. */
  private async assignedCrew(vehicleId: string) {
    const rows = await this.prisma.driverAssignment.findMany({
      where: { vehicleId, endedAt: null }, select: { driverId: true, driver: { select: { role: true } } },
    });
    const by = (role: DriverRole) => rows.find((r) => r.driver.role === role)?.driverId ?? null;
    return { driverId: by(DriverRole.DRIVER), conductorId: by(DriverRole.CONDUCTOR), helperId: by(DriverRole.HELPER) };
  }

  private towards(t: { direction: string; route: { startPlace: string; endPlace: string } | null }) {
    if (!t.route) return 'its route';
    return t.direction === 'REVERSE' ? t.route.startPlace : t.route.endPlace;
  }

  private plain(t: TripRow) {
    const { vehicle: _v, route: _r, driver: _d, conductor: _c, helper: _h, _count, ...rest } = t;
    return rest;
  }

  private view(t: TripRow) {
    const now = new Date();
    return {
      id: t.id, status: t.status, source: t.source, direction: t.direction,
      departAt: t.departAt, arriveAt: t.arriveAt,
      vehicle: t.vehicle, route: t.route, towards: this.towards(t),
      driver: t.driver, conductor: t.conductor, helper: t.helper,
      startOdometerKm: t.startOdometerKm, endOdometerKm: t.endOdometerKm,
      km: t.startOdometerKm != null && t.endOdometerKm != null ? t.endOdometerKm - t.startOdometerKm : null,
      reviews: t._count.reviews,
      locked: isLocked(t, now),
      unlockedUntil: t.unlockedUntil && t.unlockedUntil > now ? t.unlockedUntil : null,
      unlockReason: t.unlockReason,
      createdAt: t.createdAt,
    };
  }
}
