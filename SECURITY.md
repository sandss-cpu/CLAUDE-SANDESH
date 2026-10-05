# Security

How Batoma protects its users' data, how to run it safely, and what to do when something
goes wrong. The reasoning behind each control is in [THREAT_MODEL.md](THREAT_MODEL.md);
the target is OWASP ASVS Level 2.

## Reporting a vulnerability

Please write to **security@** at Batoma's domain (until the domain is live, use the
website's contact form and say "security" in the first line). Include what you found, how
to reproduce it, and what an attacker could do with it. We answer within three working
days, fix high-risk issues within 14 days, and credit you if you wish. Do not access other
people's data beyond what proves the issue, and do not run load or denial-of-service tests.

## What is protected, and how

| Data | Where | Protection |
|---|---|---|
| Passwords | `users.passwordHash` | argon2id; 10+ characters, checked against 10,000 common passwords, the person's name and email |
| Authenticator secrets | `users.totpSecret` | Encrypted (AES-256-GCM); recovery codes kept only as hashes |
| Sessions | `refresh_tokens` | Only a hash; rotated on every use, reuse ends the family; access tokens last 15 minutes and end at once on "sign out everywhere", password reset, role change or suspension |
| Driver phone and licence numbers, company contact phones, emergency contacts, income notes, lead and enquiry contacts | Their tables | Encrypted (AES-256-GCM, versioned keys); company phones searchable through a keyed hash only |
| Statement photos, verification documents | Private storage (`PRIVATE_UPLOAD_DIR` or the S3/R2 bucket) | Never public; five-minute signed links; owners and Batoma staff only; staff views audited; images re-encoded without metadata |
| Scans, website visits | `scan_events`, `site_events` | No accounts or locations; salted hashes; rolled up to daily counts after 13 months |
| Address hashes | Reviews, reports, enquiries, newsletter, audit log | Salted SHA-256; cleared after 13 months |
| Public website | `batoma_site` role | Read-only column grants and row-level security: only published, verified, live rows |

**Web and API headers.** The web app sends a strict Content-Security-Policy (`script-src
'self'`, no inline script anywhere, checked by `web-pages.spec.ts`), HSTS with preload,
`frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin` and a
Permissions-Policy that allows the camera on `scan.html` only (`scripts/web-headers.mjs`,
mirrored in `render.yaml`). The website sends `script-src 'none'`. The API uses helmet and
an exact CORS allow-list (`CORS_ORIGINS`, required in production).

**Limits.** Sign-in: lockout per account and per address with waits up to 15 minutes, and
per-route throttles on sign-in, password reset, authenticator steps, scans, reviews, leads,
uploads, imports and exports. Website forms: honeypot, signed time token, per-address limit.

**Audit.** Admin and finance changes, sign-in failures and locks, new devices, role and
account changes, exports and document views are in `audit_events`, shown in the control
panel under **Security events**.

## Keys and secrets

All are environment variables on the host, never in the repository.

| Variable | What | Rotate |
|---|---|---|
| `JWT_SECRET` | Signs access tokens | Change it and restart: everyone signs in again |
| `FIELD_ENCRYPTION_KEYS` | `v1:<base64>,v2:<base64>`: encryption keys by version; the last (or `FIELD_ENCRYPTION_KEY_ID`) encrypts new values | See below |
| `BLIND_INDEX_KEY` | Keyed hash for searchable encrypted fields | Change, then `npm run fields:encrypt` (recomputes the hashes) |
| `SIGNED_URL_SECRET` | Signs private-file links | Change and restart: open links stop working, new ones are issued |
| `SITE_API_KEY` | The website's key for forms and cache purges | Change on both the API and the website together |
| `SITE_DB_PASSWORD` | The website's database role | Change, run `npm run db:site-role`, update the website's `DATABASE_URL` |
| `S3_*`, `SMTP_*`, `SENTRY_DSN` | Storage, email, error tracking | In the provider's console, then update the host |

Generate keys with `openssl rand -base64 32` (encryption, blind index) or
`openssl rand -hex 32` (others).

**Rotating the field encryption key.** Losing every key loses the encrypted fields, so keep
a copy in the team's password manager.

1. Add a new key at the end: `FIELD_ENCRYPTION_KEYS="v1:<old>,v2:<new>"`. Restart the API:
   new values use `v2`, old values still read.
2. Run `npm run fields:encrypt` (in `backend/`, with the same environment). It re-encrypts
   every value still under `v1` and reports the counts.
3. Run `npm run fields:encrypt -- --check` until it reports nothing to do, then remove
   `v1` from the variable and restart.

## Backups and restore

- **Point-in-time recovery**: the managed Postgres plan keeps continuous backups (Render
  "Standard" or above). Restoring to a moment creates a new database; point the services at
  it.
- **Weekly logical backup**: a cron job runs `pg_dump --format=custom`, encrypts it with
  `age` to the team's public key, and uploads it to a separate private bucket kept 90 days
  (set up with the hosting blueprint, step 11). Encrypted fields stay encrypted inside the
  dump; the keys are not in it.
- **Restore drill, every quarter**: download the latest weekly dump, decrypt it, restore it
  into a scratch database (`pg_restore --clean --no-owner -d scratch dump.pgcustom`), run
  `npm run fields:encrypt -- --check` with production keys to prove every field decrypts,
  run the smoke suites against an API pointed at it, note the time taken in this file, and
  delete the scratch database.

## Retention

Raw scans and website events: 13 months, then daily counts only. Address hashes: cleared
after 13 months. Browsers seen at sign-in: forgotten after 13 months unused. The job runs
nightly at 03:30 Kathmandu time (`RetentionService`); `npm run retention` runs it now.
Accounts and what they wrote are kept until the person deletes their account (the reader's
**More → Delete my account**), which removes everything that cascades from it.

## Monitoring

- **Errors**: Sentry, when `SENTRY_DSN` is set. No IP addresses, cookies, headers or bodies
  are sent; messages are redacted like the logs.
- **Logs**: one JSON object per line in production, redacted (emails, phone numbers, tokens,
  signed-link parameters); request bodies are never logged.
- **Uptime**: an external check on `GET /health` (API) and `GET /healthz` (website) every
  minute, alerting by email; Render restarts a service whose health check fails.
- **Security events**: review the control panel's Security events weekly: repeated
  `Sign-in locked`, unexpected `Role changed` or `Authenticator reset`, data downloads.

## When something goes wrong

1. **Contain.** For a stolen account: suspend it in the control panel (ends its sessions at
   once) or ask the person to "sign out everywhere" and reset their password. For a leaked
   key: rotate it (above). For a bad deploy: roll back in Render.
2. **Preserve.** Export the relevant Security events and logs before anything is cleared.
3. **Assess.** What data, whose, since when. Field encryption limits what a database leak
   exposes; check whether keys were exposed too.
4. **Tell people.** Affected users within 72 hours of knowing, in plain language, with what
   they should do. Where personal data was exposed, follow the Individual Privacy Act,
   2075 (2018) and any guidance from the authorities; a lawyer should confirm current duties.
5. **Fix and learn.** Fix the cause, add a test that would have caught it (the IDOR suite
   and smoke scripts are the place), and write a short note in DECISIONS.md.

## Checks that run on every push

GitHub Actions (`.github/workflows/ci.yml`): typecheck (with `strictNullChecks` for the
Phase 3 modules), unit tests, the IDOR suite against a fresh database (every fleet,
finance, trip, appraisal, document and partner route, as another company and as lower
roles), the website's tests, `npm audit --omit=dev` (fails on high), both builds, and an
OWASP ZAP baseline scan of the running web app, website and API that fails on any high-risk
finding. Dependabot opens weekly update pull requests.
