# Going live

The checklist for putting Batoma on the internet, in order. Each step says who does it:
**you** (things that need your accounts, money or signature) or **Claude** (things that can
be done from the repository once you have done yours). Tick each box as you go.

`<PUBLIC_DOMAIN>` below is the domain you choose, for example `batoma.com.np`.

## 0. Decide before anything is printed

- [ ] **You:** choose `<PUBLIC_DOMAIN>`. Stickers carry `https://<PUBLIC_DOMAIN>/b/<code>`
      for as long as they stay on a bus: the domain and the `/b/` path can never change
      after the first sticker is printed. Renew the domain for several years at once.
- [ ] **You:** have the drafted Privacy notice and Terms (`/privacy`, `/terms` on the
      website, `site/src/pages/info.ts`) reviewed by a lawyer. They are marked "Draft:
      needs legal review" and kept out of search until then. Remove the draft notice and
      `noindex` once approved.
- [ ] **You:** set the advertising package prices you will offer (they are entered per
      partner in the control panel, under Website → Partner packages).

## 1. Accounts

- [ ] **You:** a [Render](https://render.com) account, on a workspace plan that allows a
      paid Postgres with **point-in-time recovery** (check the plan page; it is the reason
      a bad migration or a deleted row can be undone to the minute).
- [ ] **You:** a [Cloudflare](https://cloudflare.com) account with **R2**. Create three
      buckets: `batoma-private` (statement photos, documents), `batoma-public` (pictures)
      and `batoma-backups` (weekly backups). Only `batoma-public` gets a public custom
      domain: `media.<PUBLIC_DOMAIN>`. Create an R2 API token with read and write access to
      the three buckets.
- [ ] **You:** an email provider (Resend, Brevo, Mailgun or Amazon SES) with
      `<PUBLIC_DOMAIN>` verified (SPF, DKIM and DMARC records), and SMTP credentials.
- [ ] **You (optional):** a [Sentry](https://sentry.io) project for error tracking.
- [ ] **You:** install [age](https://github.com/FiloSottile/age) on your computer and make
      a backup key: `age-keygen -o batoma-backup.key`. Keep the file in the team's password
      manager, **not** on a server. The line starting `age1…` is the public key, used below.

## 2. Deploy the blueprint

- [ ] **You:** in Render, **New → Blueprint**, choose this repository and the `main`
      branch. Render reads `render.yaml` and creates `batoma-db`,
      `bato-api`, `bato-site`, `bato-web` and the `batoma-backup` job.
- [ ] **You:** fill in every value Render asks for (`sync: false` in `render.yaml`):

  | Service | Setting | Value |
  |---|---|---|
  | bato-api | `PUBLIC_WEB_URL`, `CORS_ORIGINS`, `API_PUBLIC_URL` | `https://app.<PUBLIC_DOMAIN>` |
  | bato-api | `SHORT_LINK_BASE`, `SITE_URL` | `https://<PUBLIC_DOMAIN>` |
  | bato-api | `MEDIA_BASE_URL` | `https://media.<PUBLIC_DOMAIN>` |
  | bato-api | `S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
  | bato-api | `S3_BUCKET`, `S3_PUBLIC_BUCKET` | `batoma-private`, `batoma-public` |
  | bato-api | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the R2 token |
  | bato-api | `SMTP_*`, `MAIL_FROM` | your email provider; `Batoma <no-reply@<PUBLIC_DOMAIN>>` |
  | bato-api | `ADMIN_INBOX` | where advertising and contact enquiries are emailed |
  | bato-api | `SENTRY_DSN` | optional |
  | bato-site | `SITE_URL` | `https://<PUBLIC_DOMAIN>` |
  | bato-site | `APP_URL` | `https://app.<PUBLIC_DOMAIN>` |
  | bato-site | `API_URL` | bato-api's Render address + `/api/v1`, e.g. `https://bato-api.onrender.com/api/v1` |
  | bato-web | `BATO_SITE_URL` | `https://<PUBLIC_DOMAIN>` |
  | batoma-backup | `BACKUP_AGE_RECIPIENT` | your `age1…` public key |
  | batoma-backup | `BACKUP_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `batoma-backups` and the R2 token |

- [ ] **You:** check `bato-web`'s `/api/*` rewrite in `render.yaml` points at bato-api's
      real address (Render may add a suffix if `bato-api` is taken). Fix it in the
      repository if so; Claude can do this.
- [ ] **You:** copy `FIELD_ENCRYPTION_KEYS` and `BLIND_INDEX_KEY` from bato-api's
      Environment page into the team's password manager **now**. Losing them loses every
      encrypted phone number, licence number and authenticator.
- [ ] **Render:** the first deploy runs migrations, creates the website's read-only role and
      encrypts personal fields (`preDeployCommand`). The API refuses to start if any
      production setting is missing or unsafe; its log says which.

## 3. DNS and HTTPS

- [ ] **You:** at your DNS provider, point `<PUBLIC_DOMAIN>` (and `www`) to `bato-site`
      and `app.<PUBLIC_DOMAIN>` to `bato-web`, as Render's Custom Domains page shows.
      `media.<PUBLIC_DOMAIN>` is set up in Cloudflare R2.
- [ ] **Render:** issues the certificates. Wait until each domain shows "Certificate issued".
- [ ] **You (later, once stable):** submit `<PUBLIC_DOMAIN>` to the
      [HSTS preload list](https://hstspreload.org). The headers are already preload-ready.

## 4. First admin

- [ ] **You:** in bato-api's Shell on Render, run (with your own name, email and a long
      passphrase, typed there and nowhere else):

      ADMIN_EMAIL=you@<PUBLIC_DOMAIN> ADMIN_NAME="Your Name" ADMIN_PASSWORD='…' npm run seed:prod

  It creates the categories, the national emergency numbers and your admin account, and
  nothing else: no demo content.
- [ ] **You:** sign in at `https://app.<PUBLIC_DOMAIN>/admin.html`. You are asked to set up
      an authenticator app; do it, and **save the ten recovery codes** it shows in the
      password manager.
- [ ] **You:** add a second admin (Users → change role), so one lost phone never locks
      Batoma out. They set up their own authenticator at first sign-in.

## 5. The TEST company and first sticker

- [ ] **You:** in the owner portal, register a bus company named **"TEST Batoma"** with one
      bus, using a separate email account. `prod_smoke.sh` only signs in to companies whose
      name starts with TEST. Verify it in the control panel.
- [ ] **You:** print that bus's sticker (Buses → the bus → Print sticker). Scan it with a
      phone on mobile data: the magazine should open on `app.<PUBLIC_DOMAIN>/b/<code>`.
- [ ] **Claude (or you):** run the production smoke test from a computer:

      SMOKE_QR=<the TEST bus's code> SMOKE_OWNER_EMAIL=<TEST owner> SMOKE_OWNER_PASSWORD='…' \
        bash scripts/prod_smoke.sh https://<PUBLIC_DOMAIN> https://app.<PUBLIC_DOMAIN> https://<bato-api address>

  Everything must pass. It checks health, https and security headers, every website page,
  the sticker's short link, a scan and a story, the owner sign-in and that signed-out and
  owner requests cannot reach admin routes.

## 6. Check what only production can show

- [ ] **Client addresses.** Sign in with a wrong password from your phone on mobile data and
      again from a computer on Wi-Fi. In the control panel's Security events the two
      "Failed sign-in" rows must show **different** "From" codes. If they show the same,
      the API is counting a proxy's address: change `TRUST_PROXY` on bato-api (2 is
      expected with the `/api` rewrite) and redeploy.
- [ ] **Emails arrive**: sign up a traveller account; the confirmation email must arrive,
      and the website's newsletter confirmation too.
- [ ] **Pictures**: upload a cover in the control panel; its address must start with
      `https://media.<PUBLIC_DOMAIN>/`.
- [ ] **Private files**: attach a statement photo to an income entry (TEST company); its
      link must expire after five minutes.

## 7. Backups and monitoring on

- [ ] **You:** in Render, run the `batoma-backup` job once by hand ("Trigger run"); a file
      `weekly/batoma-…pgcustom.age` must appear in the `batoma-backups` bucket.
- [ ] **You:** do the first restore drill (SECURITY.md, "Backups and restore") and write
      down how long it took.
- [ ] **You:** set up an uptime check (Render's own notifications, UptimeRobot or Better
      Stack) on `https://<bato-api address>/health` and `https://<PUBLIC_DOMAIN>/healthz`,
      every minute, alerting by email.
- [ ] **You:** in GitHub, turn on email notifications for failed CI runs and Dependabot.
- [ ] **You:** put a weekly reminder to read the control panel's Security events.

## 8. Rollback

If a deploy goes wrong:

1. **Code**: in Render, open the service → Events → choose the last good deploy →
   **Rollback**. The app, API and website roll back separately.
2. **Database migration gone wrong**: migrations only add (columns, tables, indexes) or
   backfill; none drops data except where DECISIONS.md says so. If one must be undone,
   restore the database to a point just before the deploy (Render → batoma-db → Recovery),
   point the services at the restored database, then roll back the code.
3. **Lost or leaked key**: SECURITY.md, "Keys and secrets".
4. **Tell people** if anyone's data was exposed: SECURITY.md, "When something goes wrong".

## Kept in step with

`render.yaml` (services and settings), `backend/.env.example` and `site/.env.example`
(every setting, commented), `backend/src/config/env.validation.ts` (what production refuses
to start without), `scripts/prod_smoke.sh`, SECURITY.md.
