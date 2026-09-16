/* eslint-disable no-console */
/**
 * A demo creator profile so the creator pages have something to show: the seeded
 * contributor becomes an approved creator, with one journey built from their own
 * published posts. Safe to re-run — the profile and journey are matched by handle
 * and slug.
 *
 *   npm run seed:creators
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** A handle that matches the account's own name, so the demo profile reads as one person. */
const handleFor = (name: string) =>
  `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16) || 'traveller'}_treks`;

async function main() {
  // Whoever has the most published posts makes the most convincing demo profile.
  const counts = await prisma.post.groupBy({
    by: ['authorId'],
    where: { status: 'PUBLISHED', moderation: 'APPROVED' },
    _count: { _all: true },
    orderBy: { _count: { authorId: 'desc' } },
    take: 1,
  });
  const authorId = counts[0]?.authorId;
  if (!authorId) {
    console.warn('  No published posts yet — run npm run seed first.');
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: authorId }, select: { id: true, name: true } });

  const handle = handleFor(user.name);
  const creator = await prisma.creatorProfile.upsert({
    where: { userId: user.id },
    update: { handle, status: 'APPROVED', isFeatured: true },
    create: {
      userId: user.id,
      handle,
      displayName: user.name,
      headline: 'Slow travel through the mid-hills, mostly by local bus',
      bio: 'I write about the roads between the famous places: the tea shop with the good fish, the ridge worth breaking a journey for, and what it all actually costs.',
      homeBase: 'Pokhara',
      specialities: ['trekking', 'food', 'bus travel'],
      languages: ['Nepali', 'English'],
      status: 'APPROVED',
      isFeatured: true,
      approvedAt: new Date(),
    },
  });

  const posts = await prisma.post.findMany({
    where: { authorId: user.id, status: 'PUBLISHED', moderation: 'APPROVED' },
    orderBy: { publishedAt: 'asc' },
    take: 4,
    select: { id: true, title: true },
  });

  const slug = 'the-prithvi-highway-slowly';
  const existing = await prisma.creatorJourney.findFirst({ where: { creatorId: creator.id, slug } });
  const journey = existing ?? await prisma.creatorJourney.create({
    data: {
      creatorId: creator.id, slug,
      title: 'The Prithvi Highway, slowly',
      summary: 'Kathmandu to Pokhara over three days instead of seven hours, getting off wherever the bus stopped long enough.',
      dayCount: 3,
      startedOn: new Date(Date.now() - 45 * 86_400_000),
      transportNpr: 2400, stayNpr: 3600, foodNpr: 2800, permitsNpr: 0, otherNpr: 900,
      gear: ['Dry bag', 'Power bank', 'Water filter bottle', 'Earplugs'],
      tips: 'Sit on the left leaving Kathmandu for the river views. Carry small notes: nobody at the tea stops can change a thousand.',
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });

  for (const [i, post] of posts.entries()) {
    await prisma.creatorJourneyPost.upsert({
      where: { journeyId_postId: { journeyId: journey.id, postId: post.id } },
      update: {},
      create: { journeyId: journey.id, postId: post.id, dayNumber: i + 1, sortOrder: i },
    });
  }

  console.log(`  @${creator.handle} (${user.name}) approved, journey "${journey.title}" with ${posts.length} posts.`);
}

main()
  .catch((e) => { console.error(`Could not seed the demo creator: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
