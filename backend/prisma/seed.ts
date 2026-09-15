/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding…');

  // ---------------- routes ----------------
  const routes = await Promise.all([
    upsertRoute('KTM-PKR', 'Kathmandu – Pokhara', 'काठमाडौं – पोखरा', 'Kathmandu', 'Pokhara', 200, 7),
    upsertRoute('KTM-CTN', 'Kathmandu – Chitwan', 'काठमाडौं – चितवन', 'Kathmandu', 'Sauraha', 150, 5.5),
    upsertRoute('PKR-JML', 'Pokhara – Jomsom', 'पोखरा – जोमसोम', 'Pokhara', 'Jomsom', 160, 9),
    upsertRoute('KTM-LMB', 'Kathmandu – Lumbini', 'काठमाडौं – लुम्बिनी', 'Kathmandu', 'Lumbini', 280, 9),
  ]);
  const [ktmPkr, ktmCtn, pkrJml] = routes;

  // ---------------- categories ----------------
  const categories = await Promise.all([
    upsertCategory('trekking', 'Trekking', 'ट्रेकिङ', '159A8C', 1),
    upsertCategory('heritage', 'Heritage', 'सम्पदा', 'C4562E', 2),
    upsertCategory('food', 'Food', 'खाना', 'F4A024', 3),
    upsertCategory('festivals', 'Festivals', 'चाडपर्व', 'E8455F', 4),
    upsertCategory('wildlife', 'Wildlife', 'वन्यजन्तु', '3E9B4F', 5),
    upsertCategory('road', 'On the Road', 'बाटोमा', '2F6FD0', 6),
  ]);
  const byCat = Object.fromEntries(categories.map((c) => [c.slug, c]));

  // ---------------- destinations ----------------
  const destinations = await Promise.all([
    upsertDestination('bandipur', 'Bandipur', 'बन्दिपुर', 'Tanahun', 'Gandaki', 27.9376, 84.4126,
      'A preserved Newar hill town on a ridge above the Prithvi Highway, with the Himalaya on clear mornings.'),
    upsertDestination('pokhara', 'Pokhara', 'पोखरा', 'Kaski', 'Gandaki', 28.2096, 83.9856,
      'Lakeside city beneath the Annapurnas and the gateway to most Nepali trekking.'),
    upsertDestination('sauraha', 'Sauraha', 'सौराहा', 'Chitwan', 'Bagmati', 27.5786, 84.4936,
      'The village at the edge of Chitwan National Park.'),
    upsertDestination('gorkha', 'Gorkha', 'गोरखा', 'Gorkha', 'Gandaki', 28.0000, 84.6333,
      'The hill fort from which modern Nepal was unified.'),
    upsertDestination('manakamana', 'Manakamana', 'मनकामना', 'Gorkha', 'Gandaki', 27.8944, 84.6389,
      'Hilltop temple reached by cable car directly from the highway.'),
    upsertDestination('jomsom', 'Jomsom', 'जोमसोम', 'Mustang', 'Gandaki', 28.7808, 83.7228,
      'Windswept town in the Kali Gandaki gorge, the doorway to Upper Mustang.'),
  ]);
  const byDest = Object.fromEntries(destinations.map((d) => [d.slug, d]));

  // ---------------- places (POIs) ----------------
  const places = [
    { name: 'Bandipur Bazaar', type: 'VIEWPOINT', latitude: 27.9376, longitude: 84.4126, district: 'Tanahun', destinationId: byDest.bandipur.id, altitudeM: 1030 },
    { name: 'Dumre Junction Bus Stop', type: 'BUS_STOP', latitude: 27.9167, longitude: 84.3833, district: 'Tanahun' },
    { name: 'Kurintar Rest Stop', type: 'BUS_STOP', latitude: 27.8500, longitude: 84.6167, district: 'Chitwan' },
    { name: 'Manakamana Cable Car Base', type: 'BUS_STOP', latitude: 27.8394, longitude: 84.6403, district: 'Chitwan', destinationId: byDest.manakamana.id },
    { name: 'Phewa Lakeside', type: 'VIEWPOINT', latitude: 28.2096, longitude: 83.9560, district: 'Kaski', destinationId: byDest.pokhara.id, altitudeM: 820 },
    { name: 'Sarangkot Sunrise Point', type: 'VIEWPOINT', latitude: 28.2439, longitude: 83.9492, district: 'Kaski', destinationId: byDest.pokhara.id, altitudeM: 1590 },
    { name: 'Western Regional Hospital', type: 'HOSPITAL', latitude: 28.2033, longitude: 83.9856, district: 'Kaski' },
    { name: 'Pokhara Tourist Police', type: 'POLICE', latitude: 28.2100, longitude: 83.9580, district: 'Kaski' },
    { name: 'Ghorepani Teahouses', type: 'TEAHOUSE', latitude: 28.4000, longitude: 83.6900, district: 'Myagdi', altitudeM: 2874 },
    { name: 'Annapurna Base Camp', type: 'TREK_START', latitude: 28.5306, longitude: 83.8783, district: 'Kaski', altitudeM: 4130 },
    { name: 'Muktinath Temple', type: 'TEMPLE', latitude: 28.8172, longitude: 83.8717, district: 'Mustang', altitudeM: 3710 },
    { name: 'Jomsom Airport', type: 'OTHER', latitude: 28.7808, longitude: 83.7228, district: 'Mustang', destinationId: byDest.jomsom.id, altitudeM: 2736 },
    { name: 'Sauraha Elephant Breeding Centre', type: 'OTHER', latitude: 27.5700, longitude: 84.4900, district: 'Chitwan', destinationId: byDest.sauraha.id },
    { name: 'Gorkha Durbar', type: 'MUSEUM', latitude: 28.0000, longitude: 84.6333, district: 'Gorkha', destinationId: byDest.gorkha.id, altitudeM: 1400 },
  ];
  for (const p of places) {
    const existing = await prisma.place.findFirst({ where: { name: p.name } });
    if (!existing) await prisma.place.create({ data: p as any });
  }

  // ---------------- users ----------------
  const admin = await upsertUser('9800000001', 'Platform Admin', 'ADMIN');
  const editor = await upsertUser('9800000002', 'Sabina Gurung', 'EDITOR', 'Kaski');
  const moderator = await upsertUser('9800000003', 'Ram Thapa', 'MODERATOR');
  const owner = await upsertUser('9800000004', 'Bandipur Homestay', 'BUSINESS_OWNER', 'Tanahun');
  const traveller = await upsertUser('9800000005', 'Anish Shrestha', 'CONTRIBUTOR', 'Kathmandu');

  // ---------------- issue + articles ----------------
  const issue = await prisma.issue.upsert({
    where: { number: 1 },
    update: {},
    create: {
      number: 1,
      title: 'The Prithvi Highway',
      titleNe: 'पृथ्वी राजमार्ग',
      strapline: 'Everything worth stopping for between Kathmandu and Pokhara',
      season: 'Autumn',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  const articles = [
    {
      slug: 'bandipur-the-town-time-forgot',
      title: 'Bandipur: the town that stepped off the highway',
      subtitle: 'A Newar trading post that survived by being bypassed',
      categoryId: byCat.heritage.id,
      routeIds: [ktmPkr.id],
      destinationIds: [byDest.bandipur.id],
      isFeatured: true,
      body: `When the Prithvi Highway was cut through the valley below in the 1970s, Bandipur lost its reason to exist. The mule trains stopped. The traders left for Dumre. What remained was a Newar bazaar town, largely untouched, sitting on a ridge at 1,030 metres.

That accident of neglect is now the reason to climb the eight kilometres up from Dumre. The main street is closed to vehicles. The buildings are the original shuttered Newar houses, most now restored. On a clear morning you can see from Dhaulagiri to Ganesh Himal without leaving the bazaar.

**Getting there.** Any Kathmandu–Pokhara bus will drop you at Dumre. From there it is a thirty-minute jeep ride, or two hours on foot if you take the old stone stairway.

**What to do.** Walk to Tundikhel at the western end for the mountain view. Visit the Bindebasini temple. Take the twenty-minute path to Siddha Gufa, one of the largest caves in Nepal.

**Where to stay.** The restored heritage houses on the main street cost more than the guesthouses on the approach road, and are worth it for one night.

**When to go.** October to December for the clearest mountain views. Avoid July and August, when the cloud sits on the ridge for days.`,
    },
    {
      slug: 'what-to-eat-on-the-prithvi-highway',
      title: 'What to eat between Kathmandu and Pokhara',
      subtitle: 'A rest-stop guide for people who have been on this bus before',
      categoryId: byCat.food.id,
      routeIds: [ktmPkr.id],
      body: `Everybody stops at Malekhu for fish. Not everybody should.

The Trishuli river fish at Malekhu is genuinely good when it is fresh, which depends entirely on the hour and the stall. Arrive at eleven in the morning and it will be excellent. Arrive at three in the afternoon on a slow day and you are eating something that has been sitting in oil.

**Better bets along the corridor.**

*Naubise, first hour.* Very good sel roti and hot milk tea at the small stalls before the climb.

*Malekhu, second hour.* Fried Trishuli fish. Ask which pan is fresh, and choose the busiest stall rather than the largest.

*Kurintar, third hour.* The dal bhat at the highway restaurants here is consistently better than at Mugling, and the plates are refilled without argument.

*Mugling, midpoint.* Everyone stops here. That is precisely why the food is mediocre and the toilets are the worst on the route. If your bus stops at Mugling, use it for the stretch and hold out.

*Dumre onward.* The last good dal bhat before Pokhara. After this the road climbs and options thin.

**A practical note.** Bus stops on this route last between fifteen and twenty-five minutes. Order the moment you sit down, and do not order anything that has to be cooked from raw.`,
    },
    {
      slug: 'manakamana-cable-car',
      title: 'The cable car that saved a three-hour climb',
      subtitle: 'Manakamana, straight off the highway',
      categoryId: byCat.heritage.id,
      routeIds: [ktmPkr.id],
      destinationIds: [byDest.manakamana.id],
      body: `The Manakamana temple sits at 1,302 metres above the Trishuli valley. Until 1998, reaching it meant a three-hour uphill walk from Abu Khaireni. Now it is a ten-minute cable car from Kurintar, directly beside the highway.

The temple is dedicated to Bhagwati, and the name means "wish-fulfilling". Devotees who receive what they asked for return to complete the vow, which is why the queues are longest after examination results and around weddings.

**Practical details.** The cable car runs from early morning to late afternoon, with a break in the middle of the day. Nepali and foreign fares differ. Expect long queues on Saturdays and during Dashain — if your bus passes on a Saturday morning, consider stopping on the return leg instead.

**Worth knowing.** Goats travel in their own cabins. If you are travelling with children, this is usually the part of the day they remember.`,
    },
    {
      slug: 'first-time-on-a-night-bus',
      title: 'Your first night bus in Nepal',
      subtitle: 'What nobody tells you before you board',
      categoryId: byCat.road.id,
      routeIds: [ktmPkr.id, ktmCtn.id, routes[3].id],
      body: `The night bus is the cheapest way to cross Nepal and the least comfortable. Both facts are worth knowing before you commit.

**Choose your seat deliberately.** The rear axle amplifies every pothole, and Nepali roads have many. Seats in the middle, over neither axle, are the smoothest. Avoid the very back row entirely.

**The bus will be cold.** Long-distance buses run the air conditioning hard, and mountain nights are genuinely cold. Carry a layer even in summer.

**Rest stops are infrequent and brief.** There will usually be one long halt around midnight and short stops otherwise. Use every one.

**Motion sickness is common.** The roads climb and turn continuously. If you are susceptible, take medication before boarding rather than after symptoms start, sit forward, and avoid reading. If you want to pass the time, listen to something instead.

**Keep valuables on your body.** Not in the overhead rack, not in the luggage hold.

**Arrival is early.** Night buses often reach their destination between four and six in the morning, before guesthouses open. Plan for a few hours of waiting, or book somewhere that expects an early arrival.`,
    },
    {
      slug: 'chitwan-in-three-days',
      title: 'Chitwan in three days, without the elephant ride',
      subtitle: 'Wildlife the way the park now wants you to see it',
      categoryId: byCat.wildlife.id,
      routeIds: [ktmCtn.id],
      destinationIds: [byDest.sauraha.id],
      body: `Chitwan was Nepal's first national park and remains the most reliable place in the country to see a one-horned rhinoceros. What has changed is how you are expected to see one.

Elephant-back safaris have been progressively phased out on welfare grounds, and the better operators no longer offer them. Jeep safaris, canoe trips and guided walks have replaced them, and are better for wildlife viewing in any case — an elephant announces its arrival, a canoe does not.

**Day one.** Arrive, walk to the Rapti riverbank for sunset. Watch for gharial on the sandbanks.

**Day two.** A full-day jeep safari into the core area, starting early. Rhino sightings are common; tiger sightings are not, and any operator promising one is not being straight with you.

**Day three.** Dugout canoe at dawn, then a guided walk with two licensed naturalists — the park requires two for walking safaris, and this is not a rule to negotiate around.

**On guides.** Use licensed guides registered with the park. The difference in what you see is considerable, and the safety difference on a walking safari is not theoretical.`,
    },
    {
      slug: 'jomsom-wind',
      title: 'The wind at Jomsom',
      subtitle: 'Why every flight leaves before lunch',
      categoryId: byCat.trekking.id,
      routeIds: [pkrJml.id],
      destinationIds: [byDest.jomsom.id],
      isFeatured: true,
      body: `The Kali Gandaki gorge runs between Annapurna and Dhaulagiri, and is by one common measure the deepest gorge on earth. It also functions as an enormous wind tunnel.

By late morning, air heated on the Terai plains is drawn north through the gorge, and by midday the wind through Jomsom is strong enough to make walking uncomfortable and flying impossible. This is why every scheduled flight to Jomsom departs in the early morning, and why afternoon arrivals are routinely cancelled.

**If you are walking.** Start early. Aim to be off the exposed valley floor by eleven. Carry a buff or scarf: the gorge is dry and the wind carries fine dust continuously.

**If you are flying.** Book the earliest slot available and build a spare day into the plan. Weather cancellations here are normal rather than exceptional, particularly outside the autumn window.

**If you are riding.** The jeep road from Beni is rough but reliable outside the monsoon. In July and August, landslides close sections without notice.`,
    },
  ];

  for (const a of articles) {
    const existing = await prisma.article.findUnique({ where: { slug: a.slug } });
    if (existing) continue;
    await prisma.article.create({
      data: {
        slug: a.slug,
        title: a.title,
        subtitle: a.subtitle,
        body: a.body,
        categoryId: a.categoryId,
        issueId: issue.id,
        authorId: editor.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        isFeatured: (a as any).isFeatured ?? false,
        readMinutes: Math.max(1, Math.round(a.body.split(/\s+/).length / 200)),
        routeLinks: { create: a.routeIds.map((routeId) => ({ routeId })) },
        destinations: (a as any).destinationIds?.length
          ? { create: (a as any).destinationIds.map((destinationId: string) => ({ destinationId })) }
          : undefined,
      },
    });
  }

  // ---------------- businesses ----------------
  const bizData = [
    { name: 'Old Bandipur Inn', category: 'HOMESTAY', district: 'Tanahun', destinationId: byDest.bandipur.id, lat: 27.9378, lng: 84.4130, tier: 'FEATURED', price: 'NPR 2,500 – 5,000', routes: [ktmPkr.id] },
    { name: 'Thakali Kitchen Dumre', category: 'RESTAURANT', district: 'Tanahun', lat: 27.9170, lng: 84.3840, tier: 'VERIFIED', price: 'NPR 350 – 700', routes: [ktmPkr.id] },
    { name: 'Lakeside Trek Company', category: 'TREKKING_AGENCY', district: 'Kaski', destinationId: byDest.pokhara.id, lat: 28.2100, lng: 83.9570, tier: 'PREMIUM', price: 'NPR 4,500 / day', routes: [ktmPkr.id, pkrJml.id] },
    { name: 'Rapti River Lodge', category: 'HOTEL', district: 'Chitwan', destinationId: byDest.sauraha.id, lat: 27.5790, lng: 84.4940, tier: 'FEATURED', price: 'NPR 3,000 – 7,000', routes: [ktmCtn.id] },
    { name: 'Sarangkot Sunrise Paragliding', category: 'PARAGLIDING', district: 'Kaski', lat: 28.2440, lng: 83.9490, tier: 'VERIFIED', price: 'NPR 8,000', routes: [ktmPkr.id] },
    { name: 'Mustang Jeep Service', category: 'TRANSPORT', district: 'Mustang', lat: 28.7810, lng: 83.7230, tier: 'FREE', price: 'NPR 2,000 / seat', routes: [pkrJml.id] },
  ];

  for (const b of bizData) {
    const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existing = await prisma.business.findUnique({ where: { slug } });
    if (existing) continue;
    const created = await prisma.business.create({
      data: {
        slug, name: b.name, category: b.category as any, district: b.district,
        destinationId: b.destinationId, latitude: b.lat, longitude: b.lng,
        tier: b.tier as any, priceRange: b.price, ownerId: owner.id,
        phone: '+9779800000000', whatsapp: '+9779800000000',
        description: `${b.name} — verified listing seeded for development.`,
        verifiedAt: b.tier === 'FREE' ? null : new Date(),
        amenities: ['Wi-Fi', 'Hot water', 'Parking'],
      },
    });
    await prisma.businessRouteTarget.createMany({
      data: b.routes.map((routeId) => ({ businessId: created.id, routeId })),
      skipDuplicates: true,
    });
    await prisma.coupon.create({
      data: {
        businessId: created.id,
        title: `Welcome offer at ${b.name}`,
        discountLabel: '10% off',
        description: 'Show this screen when you arrive.',
        validTo: new Date(Date.now() + 180 * 86_400_000),
        maxRedemptions: 200,
      },
    });
  }

  // ---------------- operator, vehicles, QR stickers ----------------
  const operator = await prisma.operator.upsert({
    where: { slug: 'ganapati-deluxe' },
    update: {},
    create: {
      name: 'Ganapati Deluxe', slug: 'ganapati-deluxe',
      contactPhone: '+9779801111111',
      verification: 'VERIFIED', verifiedAt: new Date(),
    },
  });
  await prisma.operatorAdmin.upsert({
    where: { operatorId_userId: { operatorId: operator.id, userId: admin.id } },
    update: {}, create: { operatorId: operator.id, userId: admin.id, role: 'OWNER' },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { plateKey: 'BA2KHA3456' },
    update: {},
    create: {
      operatorId: operator.id, plateNo: 'BA 2 KHA 3456', plateKey: 'BA2KHA3456',
      label: 'Deluxe AC 01', routeId: ktmPkr.id, seatCount: 39,
      busType: 'TOURIST_DELUXE', amenities: ['AC', 'CHARGING', 'RECLINING_SEATS'],
    },
  });

  // Demo sticker with a fixed code so the web prototype always works.
  await prisma.qrCode.upsert({
    where: { shortCode: 'DEMO2024' },
    update: { isActive: true },
    create: {
      shortCode: 'DEMO2024', operatorId: operator.id, vehicleId: vehicle.id,
      routeId: ktmPkr.id, seatNo: '12', placement: 'SEAT_BACK', printedAt: new Date(),
    },
  });

  // ---------------- itinerary templates ----------------
  await createTemplate('3 days in Pokhara', 'Lakeside, sunrise and a short walk', 3, 'STANDARD', [
    { dayNumber: 1, title: 'Arrive and Lakeside', stops: [
      { name: 'Phewa Lake boat', time: 'Afternoon' },
      { name: 'Lakeside dinner', time: 'Evening' }] },
    { dayNumber: 2, title: 'Sarangkot sunrise', stops: [
      { name: 'Sarangkot viewpoint', time: '5:30 AM' },
      { name: 'Paragliding', time: '10:00 AM' },
      { name: 'World Peace Pagoda', time: 'Afternoon' }] },
    { dayNumber: 3, title: 'Caves and departure', stops: [
      { name: 'Davis Falls and Gupteshwor Cave', time: 'Morning' },
      { name: 'Bus to Kathmandu', time: '1:00 PM' }] },
  ]);

  await createTemplate('Annapurna Base Camp — 7 days', 'The classic teahouse trek', 7, 'BACKPACKER', [
    { dayNumber: 1, title: 'Nayapul to Ghandruk', stops: [{ name: 'Ghandruk', time: 'Afternoon' }] },
    { dayNumber: 2, title: 'Ghandruk to Chhomrong', stops: [{ name: 'Chhomrong', time: 'Afternoon' }] },
    { dayNumber: 3, title: 'Chhomrong to Bamboo', stops: [{ name: 'Bamboo', time: 'Afternoon' }] },
    { dayNumber: 4, title: 'Bamboo to Deurali', stops: [{ name: 'Deurali', time: 'Afternoon' }] },
    { dayNumber: 5, title: 'Deurali to ABC', stops: [{ name: 'Annapurna Base Camp', time: 'Midday' }] },
    { dayNumber: 6, title: 'ABC to Bamboo', stops: [{ name: 'Bamboo', time: 'Afternoon' }] },
    { dayNumber: 7, title: 'Bamboo to Nayapul', stops: [{ name: 'Nayapul', time: 'Afternoon' }] },
  ]);

  // ---------------- permits ----------------
  const permits = [
    { code: 'TIMS', name: 'Trekkers Information Management System card', region: 'National',
      costNprForeign: 2000, costNprSaarc: 1000, costNprNepali: 0,
      whereToObtain: 'Nepal Tourism Board, Kathmandu or Pokhara',
      notes: 'Required for most trekking regions. Bring passport photos.' },
    { code: 'ACAP', name: 'Annapurna Conservation Area Permit', region: 'Annapurna',
      costNprForeign: 3000, costNprSaarc: 1000, costNprNepali: 100,
      whereToObtain: 'Nepal Tourism Board or the Besisahar / Birethanti checkpoints',
      notes: 'Checked at multiple points on the circuit and base camp routes.' },
    { code: 'SNP', name: 'Sagarmatha National Park Entry Permit', region: 'Everest',
      costNprForeign: 3000, costNprSaarc: 1500, costNprNepali: 100,
      whereToObtain: 'Monjo entry gate or Kathmandu',
      notes: 'A separate Khumbu Pasang Lhamu rural municipality fee also applies.' },
    { code: 'UMR', name: 'Upper Mustang Restricted Area Permit', region: 'Mustang',
      costNprForeign: 66000, whereToObtain: 'Department of Immigration, through a registered agency',
      notes: 'Approximately USD 500 for ten days. Independent trekking is not permitted.' },
  ];
  for (const p of permits) {
    await prisma.permit.upsert({ where: { code: p.code }, update: {}, create: p as any });
  }

  // ---------------- emergency numbers ----------------
  const emergency = [
    { label: 'Police', phone: '100', category: 'POLICE', isNational: true },
    { label: 'Ambulance', phone: '102', category: 'AMBULANCE', isNational: true },
    { label: 'Fire', phone: '101', category: 'FIRE', isNational: true },
    { label: 'Tourist Police', phone: '1144', category: 'TOURIST_POLICE', isNational: true },
    { label: 'Traffic Police', phone: '103', category: 'POLICE', isNational: true },
    { label: 'Western Regional Hospital, Pokhara', phone: '+97761520461', category: 'HOSPITAL', district: 'Kaski' },
    { label: 'Bharatpur Hospital', phone: '+97756520111', category: 'HOSPITAL', district: 'Chitwan' },
  ];
  for (const e of emergency) {
    const found = await prisma.emergencyNumber.findFirst({ where: { label: e.label } });
    if (!found) await prisma.emergencyNumber.create({ data: e as any });
  }

  // ---------------- map packs ----------------
  const packs = [
    { slug: 'gandaki', name: 'Gandaki Province', region: 'Gandaki', sizeBytes: BigInt(184_000_000),
      minLat: 27.5, minLng: 82.9, maxLat: 29.4, maxLng: 84.9 },
    { slug: 'bagmati', name: 'Bagmati Province', region: 'Bagmati', sizeBytes: BigInt(156_000_000),
      minLat: 27.0, minLng: 84.0, maxLat: 28.4, maxLng: 86.2 },
    { slug: 'annapurna-trek', name: 'Annapurna Trekking Region', region: 'Annapurna',
      sizeBytes: BigInt(62_000_000), minLat: 28.2, minLng: 83.4, maxLat: 29.0, maxLng: 84.4 },
  ];
  for (const p of packs) {
    await prisma.mapPack.upsert({
      where: { slug: p.slug }, update: {},
      create: { ...p, downloadUrl: `https://cdn.example.np/packs/${p.slug}-v1.mbtiles` },
    });
  }

  // ---------------- a community post ----------------
  const existingPost = await prisma.post.findFirst({ where: { title: 'Two hours in Bandipur on the way to Pokhara' } });
  if (!existingPost) {
    await prisma.post.create({
      data: {
        authorId: traveller.id,
        title: 'Two hours in Bandipur on the way to Pokhara',
        template: 'A_DAY_IN',
        body: `Got off at Dumre on a whim because the article said to. Took a shared jeep up, twenty minutes, three hundred rupees.

The main street is closed to traffic which I did not expect. Had tea at the far end where the ridge drops away and you can see all the way down the valley. Clouds were in so no mountains, but it was still worth the stop.

Caught the next bus down at four and reached Pokhara by seven. Would do it again but stay the night next time.`,
        destinationId: byDest.bandipur.id,
        locationName: 'Bandipur, Tanahun',
        latitude: 27.9376, longitude: 84.4126,
        status: 'PUBLISHED', moderation: 'APPROVED', publishedAt: new Date(),
      },
    });
  }

  console.log('\nSeed complete.');
  console.log('  Demo QR short code : DEMO2024\n');
  console.log('  Phone        Email                              Role             Sign-in');
  console.log('  9800000001   admin@demo.bato.travel             Admin            + authenticator');
  console.log('  9800000002   editor@demo.bato.travel            Editor           + authenticator');
  console.log('  9800000003   moderator@demo.bato.travel         Moderator        + authenticator');
  console.log('  9800000004   business-owner@demo.bato.travel    Business owner   password / OTP');
  console.log('  9800000005   contributor@demo.bato.travel       Contributor      password / OTP');
  console.log(`  Demo password for every email account: ${DEMO_PASSWORD}\n`);
  console.log('  Privileged roles must set up an authenticator app on first sign-in:');
  console.log('    1. POST /auth/otp/request     { phone }');
  console.log('    2. POST /auth/otp/verify      { phone, code }   -> challengeToken');
  console.log('    3. POST /auth/mfa/enrol/start { challengeToken } -> otpauthUri to scan');
  console.log('    4. POST /auth/mfa/enrol/confirm { challengeToken, code }');
  console.log('  Thereafter step 3 is replaced by POST /auth/mfa/verify.\n');
  console.log('  In development the OTP is returned as devCode. In production the');
  console.log('  app refuses to start without an SMS gateway configured.\n');
}

// ---------------- helpers ----------------

function upsertRoute(code: string, name: string, nameNe: string, startPlace: string,
  endPlace: string, distanceKm: number, typicalHours: number) {
  return prisma.route.upsert({
    where: { code }, update: {},
    create: { code, name, nameNe, startPlace, endPlace, distanceKm, typicalHours },
  });
}

function upsertCategory(slug: string, name: string, nameNe: string, colorHex: string, sortOrder: number) {
  return prisma.category.upsert({
    where: { slug }, update: { colorHex },
    create: { slug, name, nameNe, colorHex, sortOrder },
  });
}

function upsertDestination(slug: string, name: string, nameNe: string, district: string,
  province: string, latitude: number, longitude: number, description: string) {
  return prisma.destination.upsert({
    where: { slug }, update: {},
    create: { slug, name, nameNe, district, province, latitude, longitude, description },
  });
}

/** Development only — prisma/seed-prod.ts never creates these accounts. */
const DEMO_PASSWORD = 'BatoDemo#2026';

async function upsertUser(phone: string, name: string, role: string, homeDistrict?: string) {
  const email = `${role.toLowerCase().replace('_', '-')}@demo.bato.travel`;
  const login = { email, passwordHash: await argon2.hash(DEMO_PASSWORD), emailVerifiedAt: new Date() };
  return prisma.user.upsert({
    where: { phone }, update: { role: role as any, ...login },
    create: { phone, name, role: role as any, isPhoneVerified: true, homeDistrict, ...login },
  });
}

async function createTemplate(title: string, summary: string, dayCount: number,
  budgetStyle: string, days: Array<{ dayNumber: number; title: string; stops: any[] }>) {
  const existing = await prisma.itinerary.findFirst({ where: { title, isTemplate: true } });
  if (existing) return existing;
  return prisma.itinerary.create({
    data: {
      title, summary, dayCount, isTemplate: true, isPublic: true,
      budgetStyle: budgetStyle as any,
      estimatedCostNpr: dayCount * (budgetStyle === 'BACKPACKER' ? 2150 : 4750),
      days: {
        create: days.map((d) => ({
          dayNumber: d.dayNumber, title: d.title,
          stops: { create: d.stops.map((s, i) => ({ ...s, sortOrder: i })) },
        })),
      },
    },
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
