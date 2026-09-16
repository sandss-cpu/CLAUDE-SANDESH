/* eslint-disable no-console */
/**
 * Demo route guides so the Trips screen has something to show: the Kathmandu –
 * Pokhara highway with its usual halts, and Kathmandu – Chitwan. Safe to re-run:
 * a guide is matched by route and title, and its stops are only written once.
 *
 *   npm run seed:guides
 */
import { GuideStopKind, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface StopSpec {
  kind: GuideStopKind; name: string; description: string; km: number; minutes: number;
  tip?: string; priceFromNpr?: number; openingHours?: string; highlight?: boolean;
}

const GUIDES: Array<{ routeCode: string; title: string; summary: string; stops: StopSpec[] }> = [
  {
    routeCode: 'KTM-PKR',
    title: 'Kathmandu to Pokhara: where to stop',
    summary: 'The Prithvi Highway halts worth your time, from the Thankot checkpost to Lakeside — and the ones to skip.',
    stops: [
      { kind: 'VIEWPOINT', name: 'Naubise bend viewpoint', km: 26, minutes: 60,
        description: 'First proper view back over the Kathmandu valley rim as the highway drops towards the Trisuli.',
        tip: 'Sit on the left side leaving Kathmandu for this one.' },
      { kind: 'FOOD', name: 'Malekhu fish stalls', km: 74, minutes: 150,
        description: 'The river town every bus knows for fried Trisuli fish, served with beaten rice.',
        priceFromNpr: 350, openingHours: '6am – 9pm', tip: 'Ask for it fresh from the pan, not the warming tray.', highlight: true },
      { kind: 'ACTIVITY', name: 'Trisuli rafting put-in, Charaudi', km: 84, minutes: 170,
        description: 'Where half-day rafting trips start. Operators will pick you off the bus if you call ahead.',
        priceFromNpr: 2500 },
      { kind: 'REST_STOP', name: 'Kurintar riverside halt', km: 94, minutes: 190,
        description: 'The standard 20-minute halt: toilets, tea, and the cable car up to Manakamana.',
        openingHours: '24 hours', highlight: true },
      { kind: 'TEMPLE', name: 'Manakamana temple (cable car)', km: 96, minutes: 200,
        description: 'Ten minutes up the ropeway to the wish-granting temple. Allow two hours if you get off the bus.',
        priceFromNpr: 900, openingHours: '9am – 5pm' },
      { kind: 'FUEL', name: 'Mugling junction', km: 110, minutes: 230,
        description: 'Fuel, ATMs and the fork south to Chitwan. Buses often change drivers here.' },
      { kind: 'FOOD', name: 'Dumre daal bhaat halt', km: 135, minutes: 280,
        description: 'The lunch stop on most day services. Unlimited refills, and the vegetarian thali is the safer order.',
        priceFromNpr: 400 },
      { kind: 'LANDMARK', name: 'Bandipur ridge turn-off', km: 141, minutes: 290,
        description: 'The old Newar bazaar sits 8 km up the hill from Dumre. Worth breaking the journey for a night.',
        tip: 'Jeeps wait at the turn-off; the last one up leaves around 6pm.', highlight: true },
      { kind: 'VIEWPOINT', name: 'Damauli river confluence', km: 160, minutes: 330,
        description: 'Where the Madi and Seti rivers meet, with the Annapurnas ahead on a clear morning.' },
      { kind: 'HOTEL', name: 'Lakeside arrival, Pokhara', km: 200, minutes: 420,
        description: 'Tourist buses set down at the Lakeside stand. Most guesthouses are a 5–10 minute walk from there.',
        priceFromNpr: 1200, highlight: true },
    ],
  },
  {
    routeCode: 'KTM-CTN',
    title: 'Kathmandu to Chitwan: the jungle road',
    summary: 'Down the Prithvi Highway then south at Mugling, with the stops that make the five hours pass.',
    stops: [
      { kind: 'FOOD', name: 'Malekhu fish stalls', km: 74, minutes: 150,
        description: 'Same river halt as the Pokhara road, and still the best fish on the highway.', priceFromNpr: 350 },
      { kind: 'FUEL', name: 'Mugling junction', km: 110, minutes: 230,
        description: 'Turn south here. Last reliable ATM before Narayangadh.' },
      { kind: 'LANDMARK', name: 'Devghat confluence', km: 138, minutes: 280,
        description: 'Pilgrimage town where the Trisuli and Kali Gandaki meet, a short detour before Narayangadh.', highlight: true },
      { kind: 'SHOPPING', name: 'Narayangadh bazaar', km: 146, minutes: 300,
        description: 'The last proper market before the park. Mosquito repellent and fruit are cheaper here than in Sauraha.' },
      { kind: 'HOTEL', name: 'Sauraha lodges', km: 166, minutes: 340,
        description: 'Jeeps meet the buses at Chitrasari and run the last few kilometres to Sauraha.',
        priceFromNpr: 1500, tip: 'Agree the jeep fare before you get in.', highlight: true },
    ],
  },
];

async function main() {
  for (const spec of GUIDES) {
    const route = await prisma.route.findUnique({ where: { code: spec.routeCode } });
    if (!route) { console.warn(`  Skipped ${spec.routeCode}: no such route.`); continue; }

    const existing = await prisma.routeGuide.findFirst({ where: { routeId: route.id, title: spec.title } });
    const guide = existing ?? await prisma.routeGuide.create({
      data: {
        routeId: route.id, direction: 'BOTH', title: spec.title, summary: spec.summary,
        status: 'PUBLISHED', publishedAt: new Date(),
      },
    });
    if (existing) { console.log(`  ${spec.title}: already there`); continue; }

    await prisma.routeGuideStop.createMany({
      data: spec.stops.map((s, i) => ({
        guideId: guide.id, kind: s.kind, name: s.name, description: s.description,
        distanceFromStartKm: s.km, minutesFromStart: s.minutes, tip: s.tip ?? null,
        priceFromNpr: s.priceFromNpr ?? null, openingHours: s.openingHours ?? null,
        isHighlight: s.highlight ?? false, sortOrder: i,
      })),
    });
    console.log(`  ${spec.title}: ${spec.stops.length} stops`);
  }
}

main()
  .catch((e) => { console.error(`Could not seed guides: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
