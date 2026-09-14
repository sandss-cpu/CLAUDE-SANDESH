/* eslint-disable no-console */
/**
 * Creates three shareable test accounts that work in both the traveller app and the
 * control panel: an Admin, an Editor and a Moderator. Each has a verified email, a
 * password, and an authenticator (TOTP) secret already enrolled, so a tester only
 * adds the key to Google Authenticator or Authy.
 *
 * Re-running keeps each account's authenticator key, so testers' apps keep working,
 * and sets a new password; ROTATE_TOTP=true issues new keys. Setting a password ends
 * the account's existing sessions.
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

const prisma = new PrismaClient();

const ACCOUNTS = [
  {
    key: 'ADMIN', label: 'Admin', email: 'tester.admin@bato.test', name: 'Test Admin', role: Role.ADMIN,
    panel: 'Overview, Ads, Articles, Issues, Moderation, Users (everything)',
  },
  {
    key: 'EDITOR', label: 'Editor', email: 'tester.editor@bato.test', name: 'Test Editor', role: Role.EDITOR,
    panel: 'Articles and Issues',
  },
  {
    key: 'MODERATOR', label: 'Moderator', email: 'tester.moderator@bato.test', name: 'Test Moderator', role: Role.MODERATOR,
    panel: 'Moderation (reports and review queues) and Users (suspend / unsuspend)',
  },
];

const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_ACCOUNTS !== 'true') {
    throw new Error('Refusing to create shared test accounts in production. Set ALLOW_TEST_ACCOUNTS=true if you really mean it.');
  }
  const rotate = process.env.ROTATE_TOTP === 'true';
  const created: Array<(typeof ACCOUNTS)[number] & { password: string; secret: string; uri: string }> = [];

  for (const account of ACCOUNTS) {
    const password = process.env[`TEST_PASSWORD_${account.key}`]
      || `Bato-${account.label}-${randomBytes(6).toString('base64url')}`;
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

  for (const a of created) {
    console.log(`${a.label.padEnd(10)} ${a.email.padEnd(28)} ${a.password}   key ${groupKey(a.secret)}`);
  }

  const file = process.env.TEST_ACCOUNTS_FILE;
  if (file) {
    writeFileSync(file, renderMarkdown(created), { mode: 0o600 });
    console.log(`\nWrote ${file}`);
  }
}

function renderMarkdown(accounts: Array<(typeof ACCOUNTS)[number] & { password: string; secret: string; uri: string }>) {
  const sets = accounts.map((a, i) => `
## Set ${i + 1}: ${a.label}

| | |
|---|---|
| **Email** | \`${a.email}\` |
| **Password** | \`${a.password}\` |
| **Authenticator key** | \`${groupKey(a.secret)}\` |
| **Control panel access** | ${a.panel} |
| **Traveller app** | Read, write and publish vlogs with photos, vote, report content |

Add to an authenticator app by link (open on the phone): \`${a.uri}\`
`).join('');

  return `# Bato test accounts

Three shareable accounts. Each works in **both** the traveller app and the control panel.
Created ${new Date().toISOString().slice(0, 10)}.

> These are testing credentials. Anyone with them can act as that role. Do not create
> them on the live production site, or delete them before real users arrive.
${sets}
---

## First-time setup (each tester, once)

1. Install **Google Authenticator**, **Microsoft Authenticator** or **Authy** on your phone.
2. Tap **+** → **Enter a setup key**.
3. Account name: the email above. Key: the authenticator key above (spaces don't matter).
   Type: **Time-based**.
4. The app now shows a 6-digit code that changes every 30 seconds.

Several people can add the same key; everyone sees the same codes.

## Sign in to the traveller app

1. Open \`/login.html\` (or tap **Write → Sign in**).
2. **Email** tab → enter the email and password → **Sign in**.
3. Enter the 6-digit code from the authenticator app.

## Sign in to the control panel

1. Open \`/admin.html\`.
2. **Email** tab → email and password → **Continue**.
3. Enter the 6-digit code. The sidebar shows only the sections for that role.

The two sides keep separate sessions, so you can be signed in to both at once.

## Where the accounts work

The accounts live in the database of the copy of Bato they were created in.

- **This Mac:** run \`Start_Bato.command\`, then use \`http://localhost:5173/login.html\` and
  \`http://localhost:5173/admin.html\`. The CLAUDE SANDESH and CLAUDE COASTER copies share
  one local database, so the accounts work in both.
- **Other people's devices:** they need the deployed site (see README → Deploy to Render).
  Localhost only works on this Mac. After deploying, create the same accounts there from the
  bato-api Shell tab:
  \`ALLOW_TEST_ACCOUNTS=true npm run accounts:test\`
  That prints new passwords and keys for the live site.

## Troubleshooting

- **"That code is not valid":** the phone's clock must be set automatically; codes are
  time-based. Wait for the next code and try again.
- **"Email or password is incorrect":** passwords are case-sensitive; copy them exactly.
- **"Too many requests":** sign-in attempts are rate limited. Wait 15 minutes.
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
