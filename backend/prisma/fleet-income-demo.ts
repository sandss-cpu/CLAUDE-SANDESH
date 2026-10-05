/**
 * Demo income for the demo bus companies, laid on the demo duty log: counter and on-board
 * cash, Bussewa settlements with references and fees, eSewa (some missing their reference,
 * so reconciliation has something to flag) and the odd parcel. Income records stay off:
 * an owner still turns them on, with an authenticator, before any of this is shown.
 * Companies that already have income are left alone.
 *
 *   npm run seed:income        (after npm run seed:trips)
 */
import { IncomeSourceKind, PrismaClient } from '@prisma/client';

const DAY = 86_400_000;
const SOURCES: Array<[string, IncomeSourceKind]> = [
  ['Counter cash', 'CASH'], ['On-board cash', 'CASH'], ['Bussewa', 'PORTAL'], ['eSewa', 'PORTAL'],
  ['Khalti', 'PORTAL'], ['Other online portal', 'PORTAL'], ['Parcel/cargo', 'CARGO'], ['Reserve/hire', 'HIRE'],
];
/** Fares in rupees, by bus type; deluxe Kathmandu–Pokhara is about NPR 1,500. */
const FARE: Record<string, number> = { TOURIST_DELUXE: 1500, SOFA_SEATER: 1800, AC_DELUXE: 1300, SLEEPER: 2200, MICRO_BUS: 1100, HIACE: 900 };

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

export async function seedDemoIncome(prisma: PrismaClient) {
  const random = seeded(83);
  const operators = await prisma.operator.findMany({
    where: { slug: { in: ['himalayan-express-travels', 'shrestha-yatayat'] } },
    select: { id: true, admins: { where: { role: 'OWNER' }, select: { userId: true }, take: 1 } },
  });
  let created = 0;
  for (const op of operators) {
    if (await prisma.incomeEntry.count({ where: { operatorId: op.id } })) continue;
    if (!(await prisma.incomeSource.count({ where: { operatorId: op.id } }))) {
      await prisma.incomeSource.createMany({ data: SOURCES.map(([name, kind], position) => ({ operatorId: op.id, name, kind, position })) });
    }
    const sources = Object.fromEntries((await prisma.incomeSource.findMany({ where: { operatorId: op.id } })).map((s) => [s.name, s.id]));
    const trips = await prisma.trip.findMany({
      where: { operatorId: op.id, status: 'COMPLETED' },
      include: { vehicle: { select: { seatCount: true, busType: true } } },
      orderBy: { departAt: 'asc' },
    });
    let ref = 1000;
    const rows = [];
    for (const t of trips) {
      const seats = t.vehicle.seatCount ?? 30;
      const fare = FARE[t.vehicle.busType ?? ''] ?? 1200;
      // Kathmandu calendar day of departure.
      const day = new Date(t.departAt.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10);
      const filled = Math.round(seats * (0.55 + random() * 0.4));
      const online = Math.round(filled * (0.15 + random() * 0.2));
      const counter = Math.max(0, filled - online - (random() < 0.5 ? 2 : 0));
      const onBoard = filled - online - counter;
      const createdAt = new Date(Date.parse(`${day}T14:00:00Z`));
      const base = { operatorId: op.id, vehicleId: t.vehicleId, tripId: t.id, date: new Date(`${day}T00:00:00Z`), createdById: op.admins[0]?.userId ?? null, createdAt, lockedAt: new Date(createdAt.getTime() + 7 * DAY) };
      rows.push({ ...base, sourceId: sources['Counter cash'], ticketsSold: counter, grossPaisa: counter * fare * 100, feesPaisa: 0, netPaisa: counter * fare * 100 });
      if (onBoard > 0) rows.push({ ...base, sourceId: sources['On-board cash'], ticketsSold: onBoard, grossPaisa: onBoard * fare * 100, feesPaisa: 0, netPaisa: onBoard * fare * 100 });
      if (online > 0) {
        const viaEsewa = random() < 0.3;
        const gross = online * fare * 100;
        const fees = Math.round(gross * (viaEsewa ? 0.02 : 0.05));
        ref += 1;
        rows.push({
          ...base, sourceId: sources[viaEsewa ? 'eSewa' : 'Bussewa'], ticketsSold: online, grossPaisa: gross, feesPaisa: fees, netPaisa: gross - fees,
          // Some eSewa income was entered without its settlement number, as happens.
          reference: viaEsewa && random() < 0.5 ? null : `${viaEsewa ? 'ESW' : 'BSW'}-${ref}`,
        });
      }
      if (random() < 0.25) {
        const parcel = Math.round(300 + random() * 1700) * 100;
        rows.push({ ...base, sourceId: sources['Parcel/cargo'], ticketsSold: 0, grossPaisa: parcel, feesPaisa: 0, netPaisa: parcel, note: 'Parcels to Pokhara' });
      }
    }
    if (rows.length) {
      const { count } = await prisma.incomeEntry.createMany({ data: rows });
      created += count;
    }
  }
  return created;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedDemoIncome(prisma)
    .then((n) => console.log(n ? `Added ${n} demo income entries.` : 'Demo income already exists; nothing added.'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
