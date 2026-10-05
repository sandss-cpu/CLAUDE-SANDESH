/**
 * A demo duty log for the demo bus companies, so scorecards, the leaderboard and
 * appraisals have trips, kilometres and fuel to show.
 *
 * Trips are laid between the demo fuel fills, so their odometer readings fall inside
 * measured tanks. Each bus's own driver takes most runs and a relief driver every third,
 * so two drivers share some tanks, as they do on a real bus. Only companies with no trips
 * at all are seeded, and every trip ends at least two days ago, clear of the 48-hour edit
 * window and of anything a test starts today.
 *
 *   npm run seed:trips
 */
import { DriverRole, GuideDirection, PrismaClient, TripSource, TripStatus } from '@prisma/client';
import { withFieldEncryption } from '../src/common/crypto/field-crypto';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 06:30 in Kathmandu is 00:45 UTC. */
const atKathmandu = (d: Date, hour: number, minute = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute) - (5 * 60 + 45) * 60_000);

export async function seedDemoTrips(prisma: PrismaClient, slugs?: string[]) {
  const operators = await prisma.operator.findMany({
    where: slugs ? { slug: { in: slugs } } : { slug: { in: ['himalayan-express-travels', 'shrestha-yatayat'] } },
    select: { id: true, name: true, admins: { where: { role: 'OWNER' }, select: { userId: true }, take: 1 } },
  });
  let created = 0;
  for (const op of operators) {
    if (await prisma.trip.count({ where: { operatorId: op.id } })) continue;
    const drivers = await prisma.driver.findMany({
      where: { operatorId: op.id, isActive: true },
      include: { assignments: { where: { endedAt: null }, select: { vehicleId: true } } },
    });
    const onBus = (busId: string, role: DriverRole) =>
      drivers.find((d) => d.role === role && d.assignments.some((a) => a.vehicleId === busId)) ?? null;
    // A driver with no bus of their own covers rest days; without one, another bus's driver does.
    const relief = drivers.find((d) => d.role === DriverRole.DRIVER && !d.assignments.length) ?? null;

    const buses = await prisma.vehicle.findMany({
      where: { operatorId: op.id, isActive: true },
      select: { id: true, routeId: true, fuelLogs: { where: { fullTank: true }, orderBy: { odometerKm: 'asc' } } },
    });
    for (const bus of buses) {
      const driver = onBus(bus.id, DriverRole.DRIVER);
      const conductor = onBus(bus.id, DriverRole.CONDUCTOR);
      const helper = onBus(bus.id, DriverRole.HELPER);
      if (!driver) continue;
      const fills = bus.fuelLogs;
      let n = 0;
      for (let i = 1; i < fills.length; i++) {
        const from = fills[i - 1];
        const to = fills[i];
        const span = to.odometerKm - from.odometerKm;
        if (span <= 0) continue;
        const middle = from.odometerKm + Math.round(span / 2);
        // Out on the day after the fill, back two days later.
        const legs: Array<[GuideDirection, Date, number, number]> = [
          [GuideDirection.FORWARD, atKathmandu(new Date(from.filledAt.getTime() + DAY), 6, 30), from.odometerKm, middle],
          [GuideDirection.REVERSE, atKathmandu(new Date(from.filledAt.getTime() + 3 * DAY), 7, 0), middle, to.odometerKm],
        ];
        for (const [direction, departAt, startKm, endKm] of legs) {
          const arriveAt = new Date(departAt.getTime() + 7 * HOUR);
          if (arriveAt.getTime() > Date.now() - 2 * DAY) continue;
          n += 1;
          const atWheel = n % 3 === 0 && relief ? relief : driver;
          await prisma.trip.create({
            data: {
              operatorId: op.id, vehicleId: bus.id, routeId: bus.routeId, direction, departAt, arriveAt,
              driverId: atWheel.id, conductorId: conductor?.id ?? null, helperId: helper?.id ?? null,
              source: TripSource.MANUAL, status: TripStatus.COMPLETED,
              startOdometerKm: startKm, endOdometerKm: endKm, createdById: op.admins[0]?.userId ?? null,
            },
          });
          created += 1;
        }
      }
    }
  }
  return created;
}

if (require.main === module) {
  const prisma = withFieldEncryption(new PrismaClient());
  seedDemoTrips(prisma)
    .then((n) => console.log(n ? `Added ${n} demo trips.` : 'Demo trips already exist; nothing added.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
