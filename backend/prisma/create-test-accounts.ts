/* eslint-disable no-console */
/**
 * Creates shareable test accounts and the demo bus companies they manage.
 *
 * Control-panel accounts (Admin, Editor, Moderator) have a verified email, a password
 * and an authenticator (TOTP) secret already enrolled, so a tester only adds the key
 * to Google Authenticator or Authy. They also work in the traveller app.
 *
 * Bus owner portal accounts (fleet owner, manager, single-bus owner, pending owner)
 * and a traveller account need only an email and password.
 *
 * Re-running keeps each control-panel account's authenticator key and sets new
 * passwords (TEST_PASSWORD_<KEY> keeps a chosen one; ROTATE_TOTP=true issues new
 * keys). Setting a password ends that account's existing sessions.
 *
 * Refuses to run in production unless ALLOW_TEST_ACCOUNTS=true. These credentials are
 * shared, and an admin account controls the whole platform.
 *
 *   TEST_ACCOUNTS_FILE=../Bato_Test_Accounts.md npm run accounts:test
 */
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { FLEET_ACCOUNTS, FleetSummary, seedFleetDemo } from './fleet-demo';

const prisma = new PrismaClient();

const ACCOUNTS = [
  {
    key: 'ADMIN', label: 'Admin', email: 'tester.admin@bato.test', name: 'Test Admin', role: Role.ADMIN,
    panel: 'Overview, Bus companies, Ads, Articles, Issues, Moderation, Users (everything)',
  },
  {
    key: 'EDITOR', label: 'Editor', email: 'tester.editor@bato.test', name: 'Test Editor', role: Role.EDITOR,
    panel: 'Articles and Issues',
  },
  {
    key: 'MODERATOR', label: 'Moderator', email: 'tester.moderator@bato.test', name: 'Test Moderator', role: Role.MODERATOR,
    panel: 'Moderation (reports, bus reviews and review queues) and Users (suspend / unsuspend)',
  },
];

type Created = (typeof ACCOUNTS)[number] & { password: string; secret: string; uri: string };
type CreatedFleet = (typeof FLEET_ACCOUNTS)[number] & { password: string };

const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();
const passwordFor = (key: string, label: string) =>
  process.env[`TEST_PASSWORD_${key}`] || `Bato-${label.split(' ')[0]}-${randomBytes(6).toString('base64url')}`;

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_ACCOUNTS !== 'true') {
    throw new Error('Refusing to create shared test accounts in production. Set ALLOW_TEST_ACCOUNTS=true if you really mean it.');
  }
  const rotate = process.env.ROTATE_TOTP === 'true';
  const created: Created[] = [];

  for (const account of ACCOUNTS) {
    const password = passwordFor(account.key, account.label);
    const existing = await prisma.user.findUnique({
      where: { email: account.email },
      select: { totpSecret: true, totpConfirmedAt: true },
    });
    const secret = existing?.totpSecret && existing.totpConfirmedAt && !rotate
      ? existing.totpSecret
      : authenticator.generateSecret();

    const data = {
      name: account.name,
      role: account.role,
      language: 'EN' as const,
      passwordHash: await argon2.hash(password),
      emailVerifiedAt: new Date(),
      isSuspended: false,
      suspendedUntil: null,
      totpSecret: secret,
      totpConfirmedAt: existing?.totpConfirmedAt && !rotate ? existing.totpConfirmedAt : new Date(),
    };
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: data,
      create: { email: account.email, ...data },
    });
    // A password someone may have shared further must not leave older sessions signed in.
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    created.push({ ...account, password, secret, uri: authenticator.keyuri(account.email, 'Bato', secret) });
  }

  // Owner portal and traveller accounts: ordinary accounts, so no authenticator.
  const fleet: CreatedFleet[] = [];
  const userIds: Record<string, string> = {};
  for (const account of FLEET_ACCOUNTS) {
    const password = passwordFor(account.key, account.label);
    const data = {
      name: account.name, role: Role.READER, language: 'EN' as const,
      passwordHash: await argon2.hash(password), emailVerifiedAt: new Date(),
      isSuspended: false, suspendedUntil: null, totpSecret: null, totpConfirmedAt: null,
    };
    const user = await prisma.user.upsert({
      where: { email: account.email }, update: data, create: { email: account.email, ...data },
    });
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    userIds[account.key] = user.id;
    fleet.push({ ...account, password });
  }

  const summary = await seedFleetDemo(prisma, userIds);

  for (const a of created) {
    console.log(`${a.label.padEnd(32)} ${a.email.padEnd(28)} ${a.password}   key ${groupKey(a.secret)}`);
  }
  for (const a of fleet) {
    console.log(`${a.label.padEnd(32)} ${a.email.padEnd(28)} ${a.password}`);
  }
  for (const c of summary.companies) {
    console.log(`\n${c.name} (${c.verification}) company QR ${c.companyQr}`);
    for (const b of c.buses) console.log(`  ${b.registrationNo.padEnd(28)} ${b.label.padEnd(20)} QR ${b.qr}${b.created ? '  (new)' : ''}`);
  }

  const file = process.env.TEST_ACCOUNTS_FILE;
  if (file) {
    writeFileSync(file, renderMarkdown(created, fleet, summary), { mode: 0o600 });
    console.log(`\nWrote ${file}`);
  }
}

function renderMarkdown(accounts: Created[], fleet: CreatedFleet[], summary: FleetSummary) {
  const web = (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
  const sets = accounts.map((a, i) => `
### Set ${i + 1}: ${a.label}

| | |
|---|---|
| **Email** | \`${a.email}\` |
| **Password** | \`${a.password}\` |
| **Authenticator key** | \`${groupKey(a.secret)}\` |
| **Control panel access** | ${a.panel} |
| **Traveller app** | Read, write and publish vlogs with photos, vote, review buses, report content |

Add to an authenticator app by link (open on the phone): \`${a.uri}\`
`).join('');

  const fleetSets = fleet.map((a, i) => `
### Set ${accounts.length + i + 1}: ${a.label}

| | |
|---|---|
| **Email** | \`${a.email}\` |
| **Password** | \`${a.password}\` |
| **Sign in at** | ${a.key === 'TRAVELLER' ? `\`${web}/login.html\` (also works in the owner portal, where it can register its own company)` : `\`${web}/owner.html\``} |
| **Access** | ${a.access} |
`).join('');

  const qrTable = summary.companies.map((c) => `
**${c.name}** (${c.verification === 'VERIFIED' ? 'verified' : 'waiting for verification: links show "not active" until an admin verifies it'})

| Bus | QR code | Test link (same as scanning) |
|---|---|---|
| Whole company | \`${c.companyQr}\` | ${web}/bus.html?code=${c.companyQr} |
${c.buses.map((b) => `| ${b.registrationNo} · ${b.label} | \`${b.qr}\` | ${web}/bus.html?code=${b.qr} |`).join('\n')}
`).join('');

  return `# Bato test accounts

Shareable accounts for every side of Bato. Created ${new Date().toISOString().slice(0, 10)}.

> These are testing credentials. Anyone with them can act as that role. Do not create
> them on the live production site, or delete them before real users arrive.

## Control panel accounts (need an authenticator app)

Each works in **both** the traveller app and the control panel.
${sets}
## Bus owner portal and traveller accounts (email and password only)
${fleetSets}
---

## Bus QR codes for testing

Scanning a code with a phone camera opens the link beside it. On this Mac, open the link
in a browser instead. A fresh scan lets anyone review that bus for 12 hours without an
account; after that, sign in or scan again.
${qrTable}
Rotating a code in the owner portal (Bus → QR code → Replace sticker) makes the old link
stop working straight away.

---

## First-time setup for control panel accounts (each tester, once)

1. Install **Google Authenticator**, **Microsoft Authenticator** or **Authy** on your phone.
2. Tap **+** → **Enter a setup key**.
3. Account name: the email above. Key: the authenticator key above (spaces don't matter).
   Type: **Time-based**.
4. The app now shows a 6-digit code that changes every 30 seconds.

Several people can add the same key; everyone sees the same codes.

## What to try

**Bus owner portal** (\`/owner.html\`, owner or manager account)
1. Dashboard: total buses, satisfaction, reminders (overdue service, expiring insurance and
   licences, an open brake breakdown), fuel, and the per-bus table.
2. Buses → open *Everest Deluxe 02*: service history, documents, crew, fuel, breakdowns,
   reviews and its QR code. Mark the breakdown fixed and add it to the service history.
3. Add a service record with a kilometre reading, a note and photos; the reminder clears.
4. Register a new bus. Registering an existing number such as \`BA 1 KHA 2345\` is refused.
5. Feedback: rating trend, what passengers praise and complain about, suggestions; reply
   to a review or report an abusive one.
6. Export a bus's history as CSV or a printable report.
7. Sign in as the **manager** and confirm Company details and Team are read-only.
8. Sign in as the **pending owner** and see the "waiting for verification" banner.

**Admin** (\`/admin.html\`, Admin account): *Bus companies* shows how many buses are registered
with Bato. Verify *Pokhara Night Riders*; its QR links start working and its owner gets a
notification.

**Passengers** (\`/bus.html\`): search \`BA 1 KHA 2345\` or "Himalayan", open a QR link above,
leave a review, and report one. In the traveller app, **More → Rate this bus** does the same
for the bus whose seat sticker was scanned.

## Where the accounts work

The accounts live in the database of the copy of Bato they were created in.

- **This Mac:** run \`Start_Bato.command\`, then use \`${web}/owner.html\`, \`${web}/login.html\`
  and \`${web}/admin.html\`.
- **Other people's devices:** they need the deployed site (see README → Deploy to Render).
  Localhost only works on this Mac. After deploying, create the same accounts from the
  bato-api Shell tab: \`ALLOW_TEST_ACCOUNTS=true npm run accounts:test\`. That prints new
  passwords, keys and QR codes for the live site.

## Troubleshooting

- **"That code is not valid":** the phone's clock must be set automatically; codes are
  time-based. Wait for the next code and try again.
- **"Email or password is incorrect":** passwords are case-sensitive; copy them exactly.
- **"Too many requests":** sign-in attempts are rate limited. Wait 15 minutes.
- **"You have already reviewed this bus today":** one review per bus per device or account
  every 20 hours. Use another browser or the traveller account.
- **Lost the key:** re-run \`npm run accounts:test\` in \`travel-platform/backend\`; it keeps
  the same keys and prints them again with new passwords.
`;
}

main()
  .catch((e) => {
    console.error(`Could not create test accounts: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
