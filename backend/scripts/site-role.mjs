#!/usr/bin/env node
/**
 * Creates or refreshes the public site's read-only database role (prisma/site-role.sql)
 * and sets its password from SITE_DB_PASSWORD. Run with the API's own DATABASE_URL, the
 * tables' owner, after migrations:
 *
 *   SITE_DB_PASSWORD=... npm run db:site-role
 *
 * The site then connects as postgresql://batoma_site:<password>@<host>/<database>.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const password = process.env.SITE_DB_PASSWORD ?? '';
if (!/^[A-Za-z0-9_-]{24,}$/.test(password)) {
  console.error('SITE_DB_PASSWORD must be at least 24 letters, digits, - or _ (it goes into a connection URL).');
  process.exit(1);
}
const sql = readFileSync(fileURLToPath(new URL('../prisma/site-role.sql', import.meta.url)), 'utf8');
// Statements end with a semicolon at the end of a line, except inside a $$ … $$ block.
const statements = [];
let current = '';
let inDollar = false;
for (const line of sql.replace(/^--.*$/gm, '').split('\n')) {
  current += `${line}\n`;
  if ((line.match(/\$\$/g) || []).length % 2 === 1) inDollar = !inDollar;
  if (!inDollar && /;\s*$/.test(line)) { statements.push(current.trim().replace(/;$/, '')); current = ''; }
}
if (current.trim()) statements.push(current.trim());

const prisma = new PrismaClient();
try {
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  await prisma.$executeRawUnsafe(`ALTER ROLE batoma_site LOGIN PASSWORD '${password}'`);
  console.log(`batoma_site ready: ${statements.length} statements applied.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
