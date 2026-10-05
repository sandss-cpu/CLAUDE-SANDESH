#!/usr/bin/env node
/**
 * Brings in what the site shares with the rest of Batoma, so there is one copy of each in
 * git: the database schema (the site reads the same tables through a read-only role),
 * the fonts, the app icon and the BS calendar. Run by `npm run build`.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

mkdirSync(here('prisma'), { recursive: true });
writeFileSync(here('prisma/schema.prisma'),
  `// Copied from backend/prisma/schema.prisma by scripts/prepare.mjs. Do not edit here.\n${readFileSync(root('backend/prisma/schema.prisma'), 'utf8')}`);
cpSync(root('web/fonts'), here('public/fonts'), { recursive: true });
mkdirSync(here('public/css'), { recursive: true });
cpSync(root('web/css/fonts.css'), here('public/css/fonts.css'));
cpSync(root('web/icons'), here('public/icons'), { recursive: true });
mkdirSync(here('vendor'), { recursive: true });
cpSync(root('web/js/lib/bs-date.js'), here('vendor/bs-date.js'));
console.log('site: schema, fonts, icons and BS calendar copied in');
