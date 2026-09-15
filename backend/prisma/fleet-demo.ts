/* eslint-disable no-console */
/**
 * Demo bus companies for testing the owner portal: a verified six-bus company with
 * a manager, a verified single-bus owner, and a new company waiting for Bato to
 * verify it. Buses get service history, documents (some expiring), crew, fuel
 * logs, a breakdown and passenger reviews, so every dashboard panel has data.
 *
 * Safe to re-run: companies and buses are matched by slug and registration number,
 * and history is only written for buses this run created. It never takes over a
 * registration number that another company already holds.
 */
import { BusDocumentType, PrismaClient } from '@prisma/client';
import { normalisePlate, profileCode } from '../src/modules/fleet/fleet.util';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const dayOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const DIESEL_NPR_PER_LITRE = 178;

export const FLEET_ACCOUNTS = [
  { key: 'FLEET_OWNER', label: 'Bus company owner', email: 'owner.fleet@bato.test', name: 'Test Fleet Owner',
    access: 'Owner of Himalayan Express Travels (verified, 6 buses): everything, including company details, team and deleting buses' },
  { key: 'FLEET_MANAGER', label: 'Bus company manager', email: 'manager.fleet@bato.test', name: 'Test Fleet Manager',
    access: 'Manager at Himalayan Express Travels: buses, service, documents, crew, fuel, breakdowns and review replies; not company details, team or deleting buses' },
  { key: 'SINGLE_OWNER', label: 'Single-bus owner', email: 'owner.single@bato.test', name: 'Test Single-Bus Owner',
    access: 'Owner of Shrestha Yatayat (verified, 1 bus)' },
  { key: 'PENDING_OWNER', label: 'New owner awaiting verification', email: 'owner.pending@bato.test', name: 'Test New Owner',
    access: 'Owner of Pokhara Night Riders (not yet verified: its buses are hidden from passengers until an admin verifies it)' },
  { key: 'TRAVELLER', label: 'Traveller', email: 'traveller@bato.test', name: 'Test Traveller',
    access: 'Passenger account: find buses, leave reviews, vlog, vote and report' },
] as const;

type Rating = 1 | 2 | 3 | 4 | 5;

const COMMENTS: Record<Rating, string[]> = {
  5: [
    'Very clean bus and the driver was careful on the Mugling road.',
    'Left Kathmandu exactly on time. Comfortable seats and the charging ports worked.',
    'Helpful conductor who helped with my luggage. Would travel again.',
    'Smooth ride, clean seats and a sensible tea stop at Kurintar.',
  ],
  4: [
    'Good ride overall. The AC was a bit weak in the afternoon.',
    'Comfortable and punctual, but the lunch stop was too long.',
    'Clean bus and polite staff. Wifi did not work most of the way.',
  ],
  3: [
    'Okay trip. Seats were fine but the music was too loud.',
    'Arrived 40 minutes late, otherwise fine.',
  ],
  2: [
    'Driver was overtaking on blind corners. Felt unsafe.',
    'The bus was dirty and the charging port did not work.',
  ],
  1: [
    'Broke down near Malekhu and we waited three hours with no information.',
    'Very rude staff and the AC never worked.',
  ],
};

const SUGGESTIONS = [
  'Please add a toilet stop every two hours.',
  'Fix the charging ports.',
  'Announce stops in English as well as Nepali.',
  'Keep the music volume low on night trips.',
  'Tell passengers what is happening when there is a delay.',
  'Clean the windows before departure.',
];

/** Small deterministic generator, so a fresh database always gets the same demo data. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface BusSpec {
  plate: string; label: string; route?: string; seats: number; type: string; amenities: string[];
  make: string; model: string; year: number; colour: string; odometer: number;
  status?: 'ACTIVE' | 'IN_MAINTENANCE' | 'OFF_ROAD';
  services?: Array<{ daysAgo: number; km: number; kind?: 'ROUTINE_SERVICE' | 'REPAIR' | 'PARTS_REPLACEMENT' | 'TYRES'; title: string; note?: string; workshop?: string; cost?: number; parts?: string[] }>;
  documents?: Array<{ type: BusDocumentType; number: string; issuer: string; expiresInDays: number | null }>;
  fuel?: { fills: number; kmPerLitre: number; litres: number };
  incidents?: Array<{ daysAgo: number; kind: 'BREAKDOWN' | 'FLAT_TYRE' | 'ENGINE' | 'BRAKES'; severity: 'MINOR' | 'MAJOR' | 'CRITICAL'; location: string; description: string; resolved?: string; cost?: number }>;
  reviews?: { count: number; ratings: Rating[] };
}

interface CompanySpec {
  slug: string; name: string; phone: string; email: string; address: string; registrationNo: string; description: string;
  verification: 'VERIFIED' | 'PENDING';
  members: Array<[userKey: string, role: 'OWNER' | 'MANAGER']>;
  crew?: Array<{ name: string; phone: string; role: 'DRIVER' | 'CONDUCTOR' | 'HELPER'; licence?: string; licenceExpiresInDays?: number; bus?: number }>;
  buses: BusSpec[];
}

const STANDARD_DOCS = (plate: string, insuranceDays: number, pollutionDays: number): BusSpec['documents'] => [
  { type: 'BLUEBOOK', number: `BB-${plate.replace(/\s/g, '')}`, issuer: 'Department of Transport Management', expiresInDays: 300 },
  { type: 'INSURANCE', number: `NIC-${Math.abs(plate.length * 7919) % 100000}`, issuer: 'Nepal Insurance Co.', expiresInDays: insuranceDays },
  { type: 'ROUTE_PERMIT', number: `RP-${plate.slice(-4)}`, issuer: 'Transport Management Office', expiresInDays: 190 },
  { type: 'POLLUTION_CERTIFICATE', number: `PC-${plate.slice(-4)}`, issuer: 'Vehicle Fitness Test Centre', expiresInDays: pollutionDays },
];

const COMPANIES: CompanySpec[] = [
  {
    slug: 'himalayan-express-travels', name: 'Himalayan Express Travels', phone: '+977 1 4412345',
    email: 'info@himalayan-express.test', address: 'Gongabu New Bus Park, Kathmandu', registrationNo: 'PAN 601234567',
    description: 'Tourist deluxe and sleeper services between Kathmandu, Pokhara, Chitwan and Lumbini.',
    verification: 'VERIFIED',
    members: [['FLEET_OWNER', 'OWNER'], ['FLEET_MANAGER', 'MANAGER']],
    crew: [
      { name: 'Ram Bahadur Thapa', phone: '9841000001', role: 'DRIVER', licence: '03-06-00123456', licenceExpiresInDays: 400, bus: 0 },
      { name: 'Hari Gurung', phone: '9841000002', role: 'DRIVER', licence: '03-06-00223344', licenceExpiresInDays: 12, bus: 1 },
      { name: 'Bishnu Magar', phone: '9841000003', role: 'DRIVER', licence: '04-02-00998877', licenceExpiresInDays: -9, bus: 2 },
      { name: 'Kiran Tamang', phone: '9841000004', role: 'DRIVER', licence: '03-06-00445566', licenceExpiresInDays: 700, bus: 4 },
      { name: 'Suman Rai', phone: '9841000005', role: 'DRIVER', licence: '05-01-00112233', licenceExpiresInDays: 260 },
      { name: 'Deepak Shrestha', phone: '9841000006', role: 'CONDUCTOR', bus: 0 },
      { name: 'Anil Karki', phone: '9841000007', role: 'CONDUCTOR', bus: 2 },
      { name: 'Sunita Lama', phone: '9841000008', role: 'HELPER', bus: 4 },
    ],
    buses: [
      {
        plate: 'BA 1 KHA 2345', label: 'Everest Deluxe 01', route: 'KTM-PKR', seats: 35, type: 'TOURIST_DELUXE',
        amenities: ['AC', 'WIFI', 'CHARGING', 'RECLINING_SEATS', 'WATER'], make: 'Tata', model: 'Starbus Ultra', year: 2019,
        colour: 'White and blue', odometer: 182_400,
        services: [
          { daysAgo: 250, km: 152_600, title: 'Full service', workshop: 'Sipradi Service Centre', cost: 18_500, note: 'Engine oil, oil and fuel filters, brake adjustment.' },
          { daysAgo: 160, km: 162_800, title: 'Full service', workshop: 'Sipradi Service Centre', cost: 21_000, note: 'Oil change, air filter replaced, wheel alignment.' },
          { daysAgo: 120, km: 167_200, kind: 'PARTS_REPLACEMENT', title: 'Clutch plate replaced', workshop: 'Balaju Auto Works', cost: 32_000, parts: ['Clutch plate', 'Pressure plate', 'Release bearing'] },
          { daysAgo: 70, km: 173_500, title: 'Full service', workshop: 'Sipradi Service Centre', cost: 19_800, note: 'Oil change, brake pads checked (60%), coolant topped up.' },
        ],
        documents: STANDARD_DOCS('BA 1 KHA 2345', 18, 140),
        fuel: { fills: 8, kmPerLitre: 4.1, litres: 190 },
        incidents: [{ daysAgo: 30, kind: 'FLAT_TYRE', severity: 'MINOR', location: 'Near Mugling', description: 'Rear left tyre punctured, changed by the crew in 25 minutes.', resolved: 'Tyre repaired at Mugling and refitted as the spare.', cost: 800 }],
        reviews: { count: 14, ratings: [5, 5, 4, 5, 4, 3, 5, 4] },
      },
      {
        plate: 'BA 1 KHA 2346', label: 'Everest Deluxe 02', route: 'KTM-PKR', seats: 35, type: 'TOURIST_DELUXE',
        amenities: ['AC', 'CHARGING', 'RECLINING_SEATS'], make: 'Tata', model: 'Starbus Ultra', year: 2017,
        colour: 'White and blue', odometer: 240_100, status: 'IN_MAINTENANCE',
        services: [
          { daysAgo: 210, km: 219_000, title: 'Full service', workshop: 'Sipradi Service Centre', cost: 17_500 },
          { daysAgo: 115, km: 228_600, title: 'Full service', workshop: 'Sipradi Service Centre', cost: 19_000, note: 'Front brake pads at 30%; replace at next service.' },
        ],
        documents: STANDARD_DOCS('BA 1 KHA 2346', 95, 60),
        fuel: { fills: 6, kmPerLitre: 3.6, litres: 200 },
        incidents: [{ daysAgo: 1, kind: 'BRAKES', severity: 'MAJOR', location: 'Malekhu', description: 'Brakes overheating on the descent. Passengers moved to Everest Deluxe 01.' }],
        reviews: { count: 10, ratings: [2, 1, 3, 2, 4, 1, 2] },
      },
      {
        plate: 'GA 2 KHA 7788', label: 'Annapurna Sofa 03', route: 'KTM-PKR', seats: 29, type: 'SOFA_SEATER',
        amenities: ['AC', 'CHARGING', 'RECLINING_SEATS', 'TV', 'CCTV'], make: 'Ashok Leyland', model: 'Viking', year: 2021,
        colour: 'Red', odometer: 96_300,
        services: [{ daysAgo: 20, km: 94_900, title: 'Full service', workshop: 'Pokhara Auto Care', cost: 16_000, note: 'Oil, filters and tyre rotation.' }],
        documents: STANDARD_DOCS('GA 2 KHA 7788', 210, -5),
        fuel: { fills: 7, kmPerLitre: 4.5, litres: 170 },
        reviews: { count: 9, ratings: [5, 4, 5, 4, 4] },
      },
      {
        plate: 'BA 3 KHA 1122', label: 'Night Sleeper 04', route: 'KTM-LMB', seats: 24, type: 'SLEEPER',
        amenities: ['AC', 'BLANKETS', 'CHARGING', 'WATER'], make: 'Eicher', model: 'Skyline Pro', year: 2020,
        colour: 'Dark blue', odometer: 131_000,
        documents: STANDARD_DOCS('BA 3 KHA 1122', 45, 120),
        reviews: { count: 5, ratings: [4, 3, 5, 3] },
      },
      {
        plate: 'LU 1 KHA 4455', label: 'Lumbini AC 05', route: 'KTM-CTN', seats: 39, type: 'AC_DELUXE',
        amenities: ['AC', 'CHARGING', 'FIRST_AID', 'GPS_TRACKING'], make: 'Tata', model: 'LP 1512', year: 2022,
        colour: 'Silver', odometer: 64_800,
        services: [{ daysAgo: 35, km: 60_200, title: 'Full service', workshop: 'Butwal Motors', cost: 15_500 }],
        documents: STANDARD_DOCS('LU 1 KHA 4455', 250, 200),
        fuel: { fills: 6, kmPerLitre: 4.3, litres: 180 },
        reviews: { count: 7, ratings: [5, 5, 4, 5] },
      },
      {
        plate: 'PRADESH 3-01-001 KHA 5566', label: 'Chitwan Hiace 06', route: 'KTM-CTN', seats: 14, type: 'HIACE',
        amenities: ['AC'], make: 'Toyota', model: 'Hiace', year: 2015, colour: 'White', odometer: 311_000, status: 'OFF_ROAD',
        services: [{ daysAgo: 400, km: 298_000, title: 'Full service', workshop: 'Narayangadh Garage', cost: 9_000 }],
        documents: STANDARD_DOCS('PRADESH 3-01-001 KHA 5566', -40, -60),
      },
    ],
  },
  {
    slug: 'shrestha-yatayat', name: 'Shrestha Yatayat', phone: '9851012345', email: 'shrestha.yatayat@example.test',
    address: 'Prithvi Chowk, Pokhara', registrationNo: '', description: 'One micro bus on the Pokhara to Baglung run.',
    verification: 'VERIFIED',
    members: [['SINGLE_OWNER', 'OWNER']],
    crew: [{ name: 'Gopal Shrestha', phone: '9856000011', role: 'DRIVER', licence: '04-01-00334455', licenceExpiresInDays: 500, bus: 0 }],
    buses: [{
      plate: 'GA 1 PA 9090', label: 'Shrestha Micro', route: 'KTM-PKR', seats: 15, type: 'MICRO_BUS',
      amenities: ['CHARGING'], make: 'Toyota', model: 'Hiace Commuter', year: 2018, colour: 'Blue', odometer: 158_700,
      services: [{ daysAgo: 82, km: 149_500, title: 'Oil change and service', workshop: 'Lakeside Auto', cost: 7_500 }],
      documents: STANDARD_DOCS('GA 1 PA 9090', 25, 90),
      fuel: { fills: 5, kmPerLitre: 9.5, litres: 55 },
      reviews: { count: 6, ratings: [5, 4, 5, 3] },
    }],
  },
  {
    slug: 'pokhara-night-riders', name: 'Pokhara Night Riders', phone: '9846098765', email: 'nightriders@example.test',
    address: 'Tourist Bus Park, Pokhara', registrationNo: 'PAN 609876543', description: 'Overnight sleeper buses, Pokhara to Kathmandu.',
    verification: 'PENDING',
    members: [['PENDING_OWNER', 'OWNER']],
    buses: [
      { plate: 'GA 3 KHA 1001', label: 'Night Rider 1', route: 'KTM-PKR', seats: 24, type: 'SLEEPER', amenities: ['AC', 'BLANKETS'], make: 'Eicher', model: 'Skyline', year: 2023, colour: 'Black', odometer: 21_000 },
      { plate: 'GA 3 KHA 1002', label: 'Night Rider 2', route: 'KTM-PKR', seats: 24, type: 'SLEEPER', amenities: ['AC', 'BLANKETS'], make: 'Eicher', model: 'Skyline', year: 2023, colour: 'Black', odometer: 18_500 },
    ],
  },
];

export interface FleetSummary {
  companies: Array<{
    name: string; verification: string; companyQr: string;
    buses: Array<{ registrationNo: string; label: string; qr: string; created: boolean }>;
  }>;
}

export async function seedFleetDemo(prisma: PrismaClient, userIds: Record<string, string>): Promise<FleetSummary> {
  const routes = await prisma.route.findMany({ select: { id: true, code: true } });
  const routeId = (code?: string) => routes.find((r) => r.code === code)?.id ?? routes[0]?.id ?? null;
  const random = seeded(2026);
  const summary: FleetSummary = { companies: [] };

  for (const spec of COMPANIES) {
    // Verification is only set when the company is created, so a tester verifying the
    // pending company is not undone by running this again.
    const operator = await prisma.operator.upsert({
      where: { slug: spec.slug },
      update: {},
      create: {
        slug: spec.slug, name: spec.name, contactPhone: spec.phone, contactEmail: spec.email, address: spec.address,
        registrationNo: spec.registrationNo || null, description: spec.description, verification: spec.verification,
        verifiedAt: spec.verification === 'VERIFIED' ? new Date() : null,
      },
    });
    for (const [userKey, role] of spec.members) {
      await prisma.operatorAdmin.upsert({
        where: { operatorId_userId: { operatorId: operator.id, userId: userIds[userKey] } },
        update: { role },
        create: { operatorId: operator.id, userId: userIds[userKey], role },
      });
    }
    const companyQr = await prisma.qrCode.findFirst({ where: { operatorId: operator.id, kind: 'COMPANY', isActive: true } })
      ?? await prisma.qrCode.create({ data: { shortCode: profileCode(), operatorId: operator.id, kind: 'COMPANY', placement: 'COMPANY_PROFILE' } });

    const busRows: Array<{ id: string; created: boolean }> = [];
    const companySummary: FleetSummary['companies'][number] = {
      name: spec.name, verification: operator.verification, companyQr: companyQr.shortCode, buses: [],
    };

    for (const b of spec.buses) {
      const plateKey = normalisePlate(b.plate);
      const existing = await prisma.vehicle.findUnique({ where: { plateKey } });
      if (existing && existing.operatorId !== operator.id) {
        console.warn(`  Skipped ${b.plate}: already registered to another company.`);
        continue;
      }
      const vehicle = existing ?? await prisma.vehicle.create({
        data: {
          operatorId: operator.id, plateNo: b.plate, plateKey, label: b.label, seatCount: b.seats, busType: b.type,
          amenities: b.amenities, make: b.make, model: b.model, year: b.year, colour: b.colour,
          routeId: routeId(b.route), odometerKm: b.odometer, status: b.status ?? 'ACTIVE',
        },
      });
      const qr = await prisma.qrCode.findFirst({ where: { vehicleId: vehicle.id, kind: 'BUS', isActive: true } })
        ?? await prisma.qrCode.create({
          data: { shortCode: profileCode(), operatorId: operator.id, vehicleId: vehicle.id, routeId: vehicle.routeId, kind: 'BUS', placement: 'BUS_PROFILE' },
        });
      busRows.push({ id: vehicle.id, created: !existing });
      companySummary.buses.push({ registrationNo: vehicle.plateNo, label: vehicle.label, qr: qr.shortCode, created: !existing });
      if (existing) continue;

      for (const s of b.services ?? []) {
        await prisma.maintenanceRecord.create({
          data: {
            vehicleId: vehicle.id, kind: s.kind ?? 'ROUTINE_SERVICE', servicedAt: dayOnly(daysAgo(s.daysAgo)),
            odometerKm: s.km, title: s.title, note: s.note, workshop: s.workshop, costNpr: s.cost,
            partsReplaced: s.parts ?? [], createdById: userIds[spec.members[0][0]],
          },
        });
      }
      for (const d of b.documents ?? []) {
        await prisma.busDocument.create({
          data: {
            vehicleId: vehicle.id, type: d.type, number: d.number, issuer: d.issuer,
            issuedAt: dayOnly(daysAgo(365 - (d.expiresInDays ?? 0))),
            expiresAt: d.expiresInDays == null ? null : dayOnly(new Date(Date.now() + d.expiresInDays * DAY)),
          },
        });
      }
      if (b.fuel) {
        let km = b.odometer - b.fuel.fills * Math.round(b.fuel.kmPerLitre * b.fuel.litres);
        for (let i = 0; i < b.fuel.fills; i++) {
          const litres = Math.round(b.fuel.litres * (0.9 + random() * 0.2));
          km += Math.round(litres * b.fuel.kmPerLitre * (0.93 + random() * 0.14));
          await prisma.fuelLog.create({
            data: {
              vehicleId: vehicle.id, filledAt: daysAgo((b.fuel.fills - i) * 6), odometerKm: Math.min(km, b.odometer),
              litres, costNpr: litres * DIESEL_NPR_PER_LITRE, fullTank: true,
              station: i % 2 ? 'Nepal Oil Corporation, Balaju' : 'Mugling Petrol Pump',
            },
          });
        }
      }
      for (const inc of b.incidents ?? []) {
        await prisma.busIncident.create({
          data: {
            vehicleId: vehicle.id, kind: inc.kind, severity: inc.severity, occurredAt: daysAgo(inc.daysAgo),
            location: inc.location, description: inc.description, odometerKm: b.odometer - inc.daysAgo * 150,
            status: inc.resolved ? 'RESOLVED' : 'OPEN', resolvedAt: inc.resolved ? daysAgo(inc.daysAgo - 0.2) : null,
            resolutionNote: inc.resolved ?? null, repairCostNpr: inc.cost ?? null, reportedById: userIds[spec.members[0][0]],
          },
        });
      }
      if (b.reviews) {
        for (let i = 0; i < b.reviews.count; i++) {
          const overall = b.reviews.ratings[i % b.reviews.ratings.length];
          const nudge = () => Math.max(1, Math.min(5, overall + Math.round(random() * 2 - 1))) ;
          const comments = COMMENTS[overall];
          const created = await prisma.rideFeedback.create({
            data: {
              vehicleId: vehicle.id, routeId: vehicle.routeId, sessionId: `seed_${plateKey}_${i}`,
              qrCodeId: i % 3 === 2 ? null : qr.id,
              overall, cleanliness: nudge(), driving: nudge(), punctuality: nudge(), staff: nudge(),
              comment: random() < 0.85 ? comments[i % comments.length] : null,
              suggestion: overall <= 4 && random() < 0.6 ? SUGGESTIONS[i % SUGGESTIONS.length] : null,
              tripDate: dayOnly(daysAgo(3 + Math.floor(random() * 145))),
              createdAt: daysAgo(1 + Math.floor(random() * 150)),
            },
          });
          if (overall <= 2 && i === 0) {
            await prisma.rideFeedback.update({
              where: { id: created.id },
              data: {
                ownerReply: 'We are sorry about this trip. The bus has been sent for a full brake check, and we have spoken with the driver.',
                ownerRepliedAt: new Date(),
              },
            });
          }
        }
      }
    }

    if (spec.crew && !(await prisma.driver.count({ where: { operatorId: operator.id } }))) {
      for (const c of spec.crew) {
        const driver = await prisma.driver.create({
          data: {
            operatorId: operator.id, name: c.name, phone: c.phone, role: c.role, licenceNumber: c.licence,
            licenceExpiresAt: c.licenceExpiresInDays == null ? null : dayOnly(new Date(Date.now() + c.licenceExpiresInDays * DAY)),
          },
        });
        const bus = c.bus != null ? busRows[c.bus] : null;
        if (bus) {
          await prisma.driverAssignment.create({ data: { driverId: driver.id, vehicleId: bus.id, startedAt: daysAgo(90) } });
        }
      }
    }
    summary.companies.push(companySummary);
  }
  return summary;
}
