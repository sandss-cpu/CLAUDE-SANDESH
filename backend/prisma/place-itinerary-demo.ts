/* eslint-disable no-console */
/**
 * A demo place itinerary, so the Places tab under Trips has something to show:
 * three days in Pokhara, filed day by day. Safe to re-run — the destination is
 * matched by slug and the itinerary by title.
 *
 *   npm run seed:itinerary
 */
import { GuideStopKind, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DESTINATION = {
  slug: 'pokhara', name: 'Pokhara', district: 'Kaski', province: 'Gandaki',
  latitude: 28.2096, longitude: 83.9856,
  description: 'Lakeside town under the Annapurnas, and the start of most treks in the west.',
};

interface StopSpec {
  day: number; kind: GuideStopKind; name: string; description: string;
  minutes?: number; price?: number; hours?: string; tip?: string; highlight?: boolean;
}

const STOPS: StopSpec[] = [
  { day: 1, kind: 'HOTEL', name: 'Settle in at Lakeside', description: 'Most tourist buses set down at the Lakeside stand; guesthouses are a few minutes on foot from there.', price: 1200, highlight: true },
  { day: 1, kind: 'ACTIVITY', name: 'Row out on Phewa Tal', description: 'Hire a doonga by the hour. Late afternoon is calmest, and the Annapurnas come out as the haze drops.', price: 600, hours: '6am – 6pm', tip: 'Agree the hour and the price before you push off.' },
  { day: 1, kind: 'TEMPLE', name: 'Tal Barahi', description: 'The island shrine in the middle of the lake, five minutes by boat.', highlight: true },
  { day: 1, kind: 'FOOD', name: 'Dinner on the lake road', description: 'Thakali kitchens outnumber the pizza places once you walk north past the main strip.', price: 500 },

  { day: 2, kind: 'VIEWPOINT', name: 'Sarangkot for sunrise', description: 'Taxis leave Lakeside about 4:45am for the ridge. Dhaulagiri to Manaslu in one sweep on a clear morning.', minutes: 45, price: 1500, highlight: true, tip: 'Take a jacket: it is cold until the sun is properly up.' },
  { day: 2, kind: 'ACTIVITY', name: 'Paraglide down', description: 'Tandem flights launch from the same ridge through the morning and land by the lake.', price: 9000, hours: '9am – 1pm' },
  { day: 2, kind: 'LANDMARK', name: 'Davis Falls and Gupteshwor cave', description: 'The river disappears into the rock here, and the cave on the far side of the road follows it underground.', price: 200 },
  { day: 2, kind: 'SHOPPING', name: 'Old Bazaar', description: 'The town Pokhara was before Lakeside: Newar shopfronts, brassware and far fewer trekking shops.' },

  { day: 3, kind: 'VIEWPOINT', name: 'World Peace Pagoda', description: 'Walk up from the south shore in about an hour, or take a boat across and climb from there.', highlight: true },
  { day: 3, kind: 'OTHER', name: 'International Mountain Museum', description: 'Worth an hour before a trek: the ranges, the peoples of the high valleys, and the history of climbing them.', price: 600, hours: '9am – 5pm' },
  { day: 3, kind: 'FOOD', name: 'Last meal at Lakeside', description: 'Fish from the lake, if the kitchen has it fresh.', price: 700 },
  { day: 3, kind: 'REST_STOP', name: 'Night bus back', description: 'Tourist buses to Kathmandu leave from the Lakeside stand in the morning; night coaches go from the main park.', tip: 'Book the day before in season.' },
];

async function main() {
  const destination = await prisma.destination.upsert({
    where: { slug: DESTINATION.slug },
    update: {},
    create: DESTINATION,
  });

  const title = 'Three days in Pokhara';
  const existing = await prisma.routeGuide.findFirst({ where: { destinationId: destination.id, title } });
  if (existing) {
    console.log(`  "${title}": already there`);
    return;
  }

  const guide = await prisma.routeGuide.create({
    data: {
      kind: 'DESTINATION', destinationId: destination.id, title,
      summary: 'The lake, the sunrise from Sarangkot and the old bazaar, at the pace the town actually deserves.',
      dayCount: 3, direction: 'BOTH', status: 'PUBLISHED', publishedAt: new Date(),
    },
  });

  await prisma.routeGuideStop.createMany({
    data: STOPS.map((s, i) => ({
      guideId: guide.id, kind: s.kind, name: s.name, description: s.description,
      dayNumber: s.day, minutesFromStart: s.minutes ?? null, priceFromNpr: s.price ?? null,
      openingHours: s.hours ?? null, tip: s.tip ?? null, isHighlight: s.highlight ?? false, sortOrder: i,
    })),
  });

  console.log(`  "${title}": ${STOPS.length} stops over ${guide.dayCount} days in ${destination.name}.`);
}

main()
  .catch((e) => { console.error(`Could not seed the itinerary: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
