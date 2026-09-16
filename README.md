# Bato — Nepal Travel Magazine, Tourism & Bus Owner Platform

A Nepali travel magazine reached by scanning a QR code on a bus seat-back, with a
traveller vlog feed, offline maps, an itinerary builder, newspaper-style advertising,
a paid listing platform for tourism businesses, and a portal where bus owners and bus
companies manage their fleet and read what passengers think of each bus.

| Folder | What it is |
|---|---|
| `backend/` | NestJS 10 + Prisma 5 + PostgreSQL API |
| `web/index.html` | Installable, offline-first reader app (PWA) |
| `web/login.html` | Traveller sign in, create an account, reset a password |
| `web/bus.html` | Public bus page: find a bus, see its rating, review it, open a bus QR code |
| `web/creator.html` | Creator profiles, journeys, and the creator's own panel |
| `web/owner.html` + `owner-*.js` | Bus owner portal (separate sign-in) |
| `web/admin.html` | Control panel for editors, moderators and admins |
| `render.yaml` | One-click deployment blueprint for Render |

---

## Features

### For travellers

**Email sign-in.** Create an account with email and password, confirm it from an
emailed link, and reset a forgotten password. Phone sign-in by SMS code can be switched
on. Editors, moderators and admins also confirm with an authenticator app.

**Photo uploads, traveller vlogs, votes.** Stories with up to 10 photos go live when
published, newest first, with 👍 / 👎 counts. Photos are resized in the browser (which
strips GPS metadata) and checked by file signature on the server.

**Marketing slots.** Newspaper-style ads in twelve placements — top banner, between
magazine stories, top and bottom of articles, the vlog feed, trip planner, route guides,
maps, more screen, bus pages, creator profiles and bus search — with day, week or month
runs, linking to a website or an in-app overview page. Each ad can be aimed at chosen
routes: a targeted ad wins the slot for travellers on that corridor and never appears on
others, while an ad with no targets shows everywhere.

**Trips: road guides and place itineraries.** Editors build both in the control panel,
adding the routes and places themselves as they go.

- A **road guide** covers a corridor: the landmarks, viewpoints, food stops, hotels, rest
  stops, fuel and ATMs along it, in the order travellers pass them, with distance, time,
  prices, opening hours and tips. Travellers pick where they are heading — Kathmandu →
  Pokhara, Pokhara → Kathmandu, or any route an admin adds — and read it in their
  direction of travel. A guide written once for "both ways" is reversed automatically on
  the return leg.
- A **place itinerary** lays a destination out day by day: "Three days in Pokhara", with
  each stop filed under its day.

The Trips screen splits into *On the road* and *Places*, and every guide also lists the
magazine stories linked to that route or destination.

**Appearance, set by an admin.** *Appearance* in the control panel sets Batoma's colours
and background for every traveller, stored on the server rather than per browser. Eight
palettes — Prayer Flag, Rhododendron, Himalaya Dawn, Teahouse, Forest Trail, Monsoon,
Lakeside Sunset and Night Bus — and seven Nepal-inspired backgrounds drawn in CSS, so they
cost nothing to load: rhododendron blooms, prayer flags, a Himalaya skyline, hill terraces,
Newar lattice and lokta paper grain. Editors can still pick a separate palette for the
control panel itself.

**Batoma branding.** The reader's masthead leads with Batoma and the issue; the route, bus
company and seat sit beneath it in small type, where they belong.

**Reporting and moderation.** Anyone can report a story, comment, article or bus review.
Three different people reporting a live item hides it until a moderator decides.

**Rate your bus.** `bus.html` lets anyone search for a bus by registration number, bus
name or company, and see its rating, facilities and reviews. A review needs proof of
riding: a fresh scan of that bus's QR code, or a signed-in account. Reviews have an
overall rating, optional scores for cleanliness, driving, punctuality and staff, a public
comment and a private suggestion for the company. The traveller app's **More → Rate this
bus** opens the bus whose seat sticker was scanned.

### For creators (`/creator.html`)

An admin gives a traveller creator access, and they get a public profile built around
whole journeys rather than loose photos — the gap Instagram leaves.

| Area | What it does |
|---|---|
| **Profile** | Handle, cover, avatar, headline, bio, home base, specialities, languages and links, with counts of journeys, adventures, upvotes and followers |
| **Journeys** | A trip told in order: the posts that make it up, the road it followed, how many days it ran to, what it cost broken down by transport, stay, food and permits, the gear worth carrying and tips for the next traveller |
| **Creator panel** | Apply for access, edit the profile, create journeys, add and reorder their own posts, publish or unpublish |
| **Followers** | Readers follow a creator; their stories link back to the profile from the vlog feed |
| **Admin** | *Creators* in the control panel approves, refuses, features or suspends. Nothing is public before approval, and suspending takes the profile and its journeys down |

### For bus owners and bus companies (`/owner.html`)

A separate sign-in and dashboard that works for one bus or hundreds.

| Area | What it does |
|---|---|
| **Registration** | Register a company (verified by a Bato admin), then register buses by official registration number. A number is unique across Bato however it is written (`BA 1 KHA 2345` = `ba-1-kha-2345`), so a bus can't be claimed twice |
| **Dashboard** | Total buses by status, passenger rating and satisfaction, what needs attention, fuel spend, crew, reminders, latest reviews, open breakdowns, and a per-bus performance table |
| **Bus profiles** | Registration number, name, type, seats, make, model, facilities, route, photo, odometer, service intervals; archive and restore |
| **Reviews and feedback** | Every review and private suggestion per bus; rating trend by month, distribution, part scores, lowest-rated buses, words passengers praise and complain about; public replies; report abusive reviews to Bato |
| **Service and maintenance** | Records with date, kilometre reading, work done, workshop, cost, parts replaced and photos; full history; reminders by date or kilometres, whichever comes first |
| **Breakdowns** | Report on-the-road breakdowns and emergency repairs with severity, place, driver and photos; major ones take the bus out of service until fixed; fixes can go straight into the service history |
| **Documents** | Bluebook, route permit, insurance, pollution and fitness certificates, tax clearance, with expiry reminders 30 days ahead |
| **Crew** | Drivers, conductors and helpers with licence numbers and expiry reminders; assign to buses, with a history of who was on which bus |
| **Fuel** | Fill-ups with litres, cost and kilometres; mileage (km/l), cost per km and monthly spend |
| **QR codes** | A unique code per bus and per company, printable as stickers in English and Nepali; replacing a code disables the old sticker at once |
| **Reminders** | In-app updates plus one email summary each morning at 06:00 Kathmandu time |
| **Export** | Full bus service history as CSV or a printable report |
| **Team** | Owners and managers; managers run day-to-day records, owners also control company details, the team and deleting buses |

**Admins** see *Bus companies* in the control panel: how many buses are registered with
Bato, companies waiting for verification, and verify, reject or suspend with a reason
the company sees. Held and reported bus reviews appear in Moderation.

**Appearance.** The control panel ships seven colour palettes — Prayer Flag (Bato's own),
Himalaya Dawn, Teahouse, Rhododendron, Forest Trail, Slate and Night Bus. Pick one under
*Appearance* in the sidebar; the choice is per browser, so each editor keeps their own.

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
returned in the API response (`devLink`, `devCode`) and shown on the sign-in pages,
so everything works without credentials. Production refuses to start in that state.

### 3. Web app

```bash
docker compose up -d web      # http://localhost:5173
```

Or any static server, e.g. `python3 -m http.server 5173` inside `web/`.

### Test accounts and demo bus companies

```bash
cd backend
TEST_ACCOUNTS_FILE=../Bato_Test_Accounts.md npm run accounts:test
```

Creates shareable accounts and writes them, with passwords, authenticator keys and bus
QR test links, to the file:

| Account | Use |
|---|---|
| `tester.admin@`, `tester.editor@`, `tester.moderator@bato.test` | Control panel (with authenticator) and traveller app |
| `owner.fleet@bato.test` | Owner of *Himalayan Express Travels*: 6 buses with service history, documents, crew, fuel, a breakdown and reviews |
| `manager.fleet@bato.test` | Manager at the same company |
| `owner.single@bato.test` | Owner of *Shrestha Yatayat*, one bus |
| `owner.pending@bato.test` | Owner of *Pokhara Night Riders*, waiting for verification |
| `traveller@bato.test` | Passenger account for reviewing buses |

`npm run seed` still creates the original demo accounts (password `BatoDemo#2026`) and
the demo seat sticker **`DEMO2024`**. Two more seeds fill the new screens:

```bash
npm run seed:guides      # road guides for Kathmandu–Pokhara and Kathmandu–Chitwan
npm run seed:itinerary   # a three-day Pokhara place itinerary
npm run seed:creators    # an approved demo creator with a journey
```

### API checks

```bash
cd backend
bash scripts/fleet_smoke.sh ../Bato_Test_Accounts.md
```

113 checks of the bus owner portal: access control between companies and roles,
records, reminders, QR codes, reviews and admin verification. It uses a throwaway bus
and leaves the demo data as it was.

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

   The API will not start until these are set; that is deliberate. `PUBLIC_WEB_URL` is
   also what every bus QR code points at, so set it to the final domain **before
   printing stickers**.
5. Redeploy both services. Migrations run automatically before each deploy.
6. Create the first admin from the bato-api **Shell** tab:

   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='a long password' npm run seed:prod
   ```

7. Sign in at `https://<bato-web address>/admin.html` and set up your authenticator app.
   Bus owners sign up at `https://<bato-web address>/owner.html`; verify their companies
   under *Bus companies*.

To give testers accounts on the live site, run
`ALLOW_TEST_ACCOUNTS=true npm run accounts:test` in the Shell tab, and delete those
accounts before real users arrive.

The API instance must be a paid plan (Starter or above): Render's free instances have
no persistent disk, so uploaded photos would disappear on every deploy.

---

## API surface

Every successful response is wrapped as `{ "success": true, "data": ... }`.

| Prefix | Notable endpoints |
|---|---|
| `/auth` | `email/register`, `email/verify`, `email/login`, `password/forgot`, `password/reset`, `otp/*`, `mfa/verify`, `refresh` (register, resend and forgot take `app: "owner"` so links open the owner portal) |
| `/fleet` | Owner portal: `companies`, `companies/:id/dashboard`, `…/buses`, `…/reviews`, `…/drivers`, `…/members`, `…/qr`, `…/notifications`; `buses/:id` with `maintenance`, `incidents`, `documents`, `fuel`, `crew`, `qr`, `qr/rotate`, `history`, `archive`; `reviews/:id/reply`, `reviews/:id/report` |
| `/fleet/admin` | `stats`, `companies`, `companies/:id/verification`, `reminders/run` (admin only) |
| `/buses` | Public: `search`, `scan/:code`, `companies/:slug`, `:id`, `:id/reviews` |
| `/guides` | Public: `journeys` (road guides and place itineraries), `:id`; editors and admins: `admin` list and detail, create, edit, `:id/status`, `:id/stops`, `:id/stops/reorder`, `admin/stops/:stopId` |
| `/settings` | Public: `theme`; admins: `PATCH theme` (palette, background, app name) |
| `/creators` | Public: list, `:handle`, `:handle/journeys/:slug`; signed in: `apply`, `me`, `me/journeys…`, `:handle/follow`; admins: `admin`, `admin/:id` |
| `/posts` | feed (newest first), `publish`, `:id/vote`, `mine` |
| `/media` | `upload` |
| `/ads` | public slot by `placement` (optionally `routeId`), `impressions`, `:id/click`, `:id/overview`; `admin` |
| `/moderation` | `report`, `queue`, `reports`, `bus-reviews`, `act`, `audit` |
| `/magazine` | articles, issues, categories, `elevate`; `admin/articles`, `admin/issues` |
| `/qr` | `r/:code`: everything a reader needs from one seat-sticker scan, including a bus review token |
| `/health` | liveness and database check (outside the API prefix) |

---

## Security notes

- **Refuses unsafe configuration.** In production the API will not start without a
  real `JWT_SECRET`, SMTP settings, HTTPS public URLs and an explicit CORS list.
- **Passwords** are hashed with argon2id; sessions are 15-minute access tokens with
  rotating refresh tokens and reuse detection.
- **Second factor** for admins, editors, moderators and operator admins. Bus owner
  accounts are ordinary accounts; their access comes only from company membership.
- **Fleet access control** is checked in the service for every record: someone outside
  a company gets "not found" for its buses, so ids can't be probed. Managers can't
  change company details, the team, or delete buses.
- **No hijacking a fleet.** Registration numbers are unique across Bato after
  normalisation, and a company's buses, profile and QR codes are public only once a
  Bato admin has verified it. Changing a verified company's name or registration number
  sends it back for verification.
- **QR codes can't be misused.** Profile codes are 10 random characters (about 10¹⁵
  combinations), only resolve for verified companies and active buses, and can be
  replaced, which disables the old sticker immediately. A scan returns a signed token
  that is valid for 12 hours and only for that bus (or that company's buses); the page
  removes the code from the address bar so a shared link doesn't pass on "scanned on board".
- **Honest reviews.** One review per bus per device or account every 20 hours, a ceiling
  per network, the word filter, community reporting and moderation. Owners can reply and
  report but never delete reviews, and never see who wrote them.
- **Uploads** are checked by file signature and renamed to UUIDs; bus, document, service
  and incident photos may only reference images uploaded through Bato.
- **Exports** guard against spreadsheet formula injection.
- Closed during this review: the old seat-sticker minting and deactivation endpoints and
  `POST /operators/vehicles` accepted any company id from an operator role; they are now
  admin-only. The old anonymous `POST /operators/feedback` accepted any vehicle from anyone;
  it is replaced by `POST /buses/:id/reviews`.

## Follow-ups before scaling

1. **Framework upgrades.** `npm audit` reports advisories fixed only in NestJS 12 and
   nodemailer 10. Both are major upgrades; do them with a test suite in place.
2. **Tests.** `scripts/fleet_smoke.sh` covers the owner portal API; turn it and the
   earlier smoke scripts into a Jest suite.
3. **Uploads on object storage** (S3-compatible, behind a CDN on a separate domain).
4. **Content-Security-Policy** for the web app. The owner portal's scripts are already
   in separate files; the older pages still use inline scripts.
5. **Company verification documents.** Admins verify by checking details by phone or
   email; an upload for PAN or bluebook scans would speed this up.
6. **SMS reminders** for owners without email, through the existing SMS gateway.
