# Bato — Nepal Travel Magazine & Tourism Platform

A Nepali travel magazine reached by scanning a QR code on a bus seat-back, with a
traveller vlog feed, offline maps, an itinerary builder, newspaper-style advertising
and a paid listing platform for tourism businesses.

| Folder | What it is |
|---|---|
| `backend/` | NestJS 10 + Prisma 5 + PostgreSQL API |
| `web/index.html` | Installable, offline-first reader app (PWA) |
| `web/login.html` | Sign in, create an account, reset a password |
| `web/admin.html` | Control panel for editors, moderators and admins |
| `render.yaml` | One-click deployment blueprint for Render |

---

## Features

**Email sign-in.** Create an account with email and password, confirm it from an
emailed link, and reset a forgotten password. Phone sign-in by SMS code is still
available and can be switched off in production. Editors, moderators and admins
also confirm with an authenticator app.

**Photo uploads.** Travellers add up to 10 photos to a story; editors add article
covers; admins add ad images. Photos are resized and re-encoded in the browser,
which also strips the phone's GPS metadata. The server checks each file's real
signature, and a post may only show images uploaded through Bato.

**Traveller vlogs.** The Read screen has *Magazine* and *Traveller vlogs* tabs. A story
goes live as soon as it is published, newest first, with 👍 / 👎 counts shown
separately. One vote per person, which they can change or remove. Text that trips
the word filter waits for a moderator instead.

**Marketing slots.** Admins create newspaper-style ads with an image, choose a
placement (top banner, between stories, top or bottom of articles), set a run in
days, weeks or months, and link to an https website or an overview page inside the
app. Views and clicks are counted; status is worked out from the dates, so an
expired ad never shows.

**Reporting and moderation.** Anyone can report a story, comment or article with a
reason and a note, signed in or not. Once three different people report a live story
it is hidden until a moderator decides. The control panel groups reports per item
with a preview, and moderators can keep, hide or remove it, or suspend the author.
Every decision is written to the audit log.

---

## Run it locally

### 1. Database

```bash
docker compose up -d db
```

Or point `DATABASE_URL` at any PostgreSQL 14+ instance.

### 2. API

```bash
cd backend
cp .env.example .env          # set JWT_SECRET: openssl rand -base64 48
npm install
npx prisma migrate dev
npm run seed
npm run start:dev             # http://localhost:3000/api/v1
```

With no SMTP or SMS gateway configured, confirmation links and sign-in codes are
returned in the API response (`devLink`, `devCode`) and shown on the sign-in page,
so everything works without credentials. Production refuses to start in that state.

### 3. Web app

```bash
docker compose up -d web      # http://localhost:5173
```

Or any static server, e.g. `python3 -m http.server 5173` inside `web/`. It must be
served over HTTP for the service worker to register. `web/config.js` points the pages
at the local API.

### Demo accounts

`npm run seed` creates these. The password for every email account is **`BatoDemo#2026`**.

| Email | Phone | Role |
|---|---|---|
| admin@demo.bato.travel | 9800000001 | Admin |
| editor@demo.bato.travel | 9800000002 | Editor |
| moderator@demo.bato.travel | 9800000003 | Moderator |
| business-owner@demo.bato.travel | 9800000004 | Business owner |
| contributor@demo.bato.travel | 9800000005 | Contributor |

Admin, editor and moderator accounts set up an authenticator app (Google
Authenticator, Authy…) the first time they sign in at `/admin.html`.

Demo QR sticker: short code **`DEMO2024`** (Kathmandu–Pokhara, seat 12).

---

## Deploy to Render

`render.yaml` creates a managed Postgres database, the API (with a persistent disk
for uploads) and the static web app, all in Render's Singapore region.

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository, and apply.
3. Choose an email provider (Resend, Brevo, Mailgun, Amazon SES…), verify your
   sending domain with it, and note its SMTP host, username and password.
4. When the services exist, fill in the values Render asks for:

   | Service | Variable | Value |
   |---|---|---|
   | bato-api | `PUBLIC_WEB_URL`, `CORS_ORIGINS` | `https://<bato-web address>` |
   | bato-api | `API_PUBLIC_URL` | `https://<bato-api address>` |
   | bato-api | `MEDIA_BASE_URL` | `https://<bato-api address>/static` |
   | bato-api | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | from your email provider |
   | bato-web | `BATO_API_URL` | `https://<bato-api address>` |

   The API will not start until these are set; that is deliberate.
5. Redeploy both services.
6. Create the first admin from the bato-api **Shell** tab:

   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='a long password' npm run seed:prod
   ```

   This adds the magazine categories and the admin account only. It never creates the
   demo accounts, and it never changes an account that already exists.
7. Sign in at `https://<bato-web address>/admin.html`, set up your authenticator app,
   then create issues, articles and ads.

The API instance must be a paid plan (Starter or above): Render's free instances have
no persistent disk, so uploaded photos would disappear on every deploy.

---

## API surface

Every successful response is wrapped as `{ "success": true, "data": ... }`.

| Prefix | Notable endpoints |
|---|---|
| `/auth` | `email/register`, `email/verify`, `email/login`, `password/forgot`, `password/reset`, `otp/request`, `otp/verify`, `mfa/verify`, `refresh` |
| `/posts` | feed (newest first), `publish`, `:id/vote`, `mine` |
| `/media` | `upload` |
| `/ads` | public slot by `placement`, `impressions`, `:id/click`, `:id/overview`; `admin` create, edit, pause, delete |
| `/moderation` | `report`, `queue`, `reports` (grouped with previews), `act`, `audit` |
| `/magazine` | articles, issues, categories, `elevate`; `admin/articles`, `admin/issues` |
| `/qr` | `r/:code` — everything a reader needs from one scan |
| `/engagement`, `/places`, `/itineraries`, `/businesses`, `/operators`, `/safety`, `/users`, `/admin` | as before |
| `/health` | liveness and database check (outside the API prefix) |

---

## Security notes

- **Refuses unsafe configuration.** In production the API will not start without a
  real `JWT_SECRET`, SMTP settings, HTTPS public URLs and an explicit CORS list, or with
  phone sign-in on but no SMS gateway. Each of these used to fail silently.
- **Codes and links never leave the server in production.** `devCode` and `devLink`
  only exist when no gateway is configured, which production does not allow.
- **Passwords** are hashed with argon2id. A wrong email and a wrong password take the
  same time and return the same message. Resetting a password signs out every session.
- **Sessions:** 15-minute access tokens, rotating refresh tokens with reuse detection.
  The web apps refresh one at a time across tabs, because presenting a refresh token
  twice ends the whole session.
- **Second factor** for admins, editors, moderators and operator admins, whichever
  way they sign in.
- **Uploads** are checked by file signature and renamed to UUIDs; posts and ads may
  only reference images uploaded through Bato.
- **Ad links** must be https and are marked `rel="sponsored noopener noreferrer"`.
- **Reports** store a salted hash of the network address, never the address, and
  are rate-limited. `TRUST_PROXY=1` on Render so limits apply per visitor rather than
  to Render's proxy.
- **Web app headers:** `render.yaml` sets `nosniff`, `X-Frame-Options`, a referrer
  policy and no-cache on pages, the service worker and config, so deploys reach
  returning readers.

## Follow-ups before scaling

1. **Framework upgrades.** `npm audit` reports advisories that are only fixed in
   NestJS 12 and nodemailer 10. Both are major upgrades; do them with a test suite in place.
2. **Tests.** There is no automated test suite yet. Start with the auth, reporting
   and ads flows.
3. **Uploads on object storage** (S3-compatible, behind a CDN on a separate domain)
   once traffic grows; the local disk is fine to launch.
4. **Content-Security-Policy** for the web app. The pages use inline scripts, so this
   needs script hashes or moving scripts into files.
5. Turn on `strictNullChecks`, add real MBTiles map packs, and generate the narration
   audio that `Article.audioUrl` points at.
