/* eslint-disable no-console */
/**
 * Production seed: the magazine categories and the first admin account.
 *
 * Never creates the demo phone accounts or sample content from seed.ts, and
 * never overwrites an existing account, so it is safe to run more than once.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='…' npm run seed:prod
 */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const CATEGORIES = [
  { slug: 'trekking', name: 'Trekking', nameNe: 'ट्रेकिङ', colorHex: '159A8C', sortOrder: 1 },
  { slug: 'heritage', name: 'Heritage', nameNe: 'सम्पदा', colorHex: 'C4562E', sortOrder: 2 },
  { slug: 'food', name: 'Food', nameNe: 'खाना', colorHex: 'F4A024', sortOrder: 3 },
  { slug: 'festivals', name: 'Festivals', nameNe: 'चाडपर्व', colorHex: 'E8455F', sortOrder: 4 },
  { slug: 'wildlife', name: 'Wildlife', nameNe: 'वन्यजन्तु', colorHex: '3E9B4F', sortOrder: 5 },
  { slug: 'road', name: 'On the Road', nameNe: 'बाटोमा', colorHex: '2F6FD0', sortOrder: 6 },
];

/**
 * Nepal's national emergency numbers.
 *
 * These belong in the production seed, not just the demo seed: the safety
 * directory is the one screen that has to work for a traveller with no
 * account and no signal, and an empty directory on a fresh deploy would leave
 * them with nothing. District numbers (hospitals and the like) are added by an
 * admin afterwards, since they depend on where the service actually runs.
 */
const EMERGENCY = [
  { label: 'Police', phone: '100', category: 'POLICE', isNational: true },
  { label: 'Ambulance', phone: '102', category: 'AMBULANCE', isNational: true },
  { label: 'Fire', phone: '101', category: 'FIRE', isNational: true },
  { label: 'Tourist Police', phone: '1144', category: 'TOURIST_POLICE', isNational: true },
  { label: 'Traffic Police', phone: '103', category: 'POLICE', isNational: true },
];

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || 'Bato Admin';
  const password = process.env.ADMIN_PASSWORD ?? '';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to the first admin’s email address.');
  }
  if (password.length < 12) {
    throw new Error('Set ADMIN_PASSWORD to at least 12 characters. This account controls the whole platform.');
  }

  for (const category of CATEGORIES) {
    await prisma.category.upsert({ where: { slug: category.slug }, update: {}, create: category });
  }
  console.log(`Categories ready (${CATEGORIES.length}).`);

  // Matched by label so re-running never duplicates a number.
  for (const e of EMERGENCY) {
    const found = await prisma.emergencyNumber.findFirst({ where: { label: e.label } });
    if (!found) await prisma.emergencyNumber.create({ data: e as any });
  }
  console.log(`Emergency numbers ready (${EMERGENCY.length}).`);

  const existing = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  if (existing) {
    console.log(`An account for ${email} already exists (role ${existing.role}). Left unchanged.`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      role: Role.ADMIN,
      passwordHash: await argon2.hash(password),
      emailVerifiedAt: new Date(),
      language: 'EN',
    },
  });
  console.log(`Created admin ${email}. Sign in at /admin.html; an authenticator app is set up at first sign-in.`);
}

main()
  .catch((e) => {
    console.error(`Production seed failed: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
