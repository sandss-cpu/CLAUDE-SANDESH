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
