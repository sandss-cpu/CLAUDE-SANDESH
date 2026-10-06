# Batoma: Nepal travel magazine, bus owner and partner platform

A Nepali travel magazine reached by scanning the QR code on a bus seat, with road guides
and stops along the way, traveller stories, a portal where bus companies run their fleet,
duty log, driver appraisals and income records, a partner area for hotels, restaurants and
agencies, and a public website that markets the magazine and its partners.

| Folder | What it is |
|---|---|
| `backend/` | API: NestJS 11 (Express 5), Prisma 5, PostgreSQL 16 |
| `site/` | Public website (`bato-site`): server-rendered, no script, read-only database role |
| `web/index.html` + `web/js/reader.js` | Installable, offline-first reader app, opened at `/b/<code>` from a sticker |
| `web/login.html` | Sign in, create an account, reset a password, recovery codes |
| `web/owner.html` + `owner-*.js` | Bus owner portal: fleet, duty log, crew and appraisals, income records |
| `web/business.html` | Partner area: enquiries, deals, reviews, monthly report, listing, documents |
| `web/admin.html` + `web/js/admin*.js` | Control panel: magazine, route programming, bus companies, website and partners, moderation, security events |
| `web/bus.html`, `web/scan.html`, `web/creator.html` | Public bus page, in-app scanner, creator profiles |
| `render.yaml` | Deployment blueprint: API, app, website, Postgres, weekly backup |
| `GO_LIVE.md`, `SECURITY.md`, `THREAT_MODEL.md` | Launch checklist, security operations, threat model |
| `DECISIONS.md`, `GAPS.md`, `CLAUDE.md` | Why things are as they are, what is not done, notes for maintainers |
| `PHASE3_REPORT.md` | What Phase 3 built, its test results, and what is left before going live |

---

## Features

### Added in Phase 3

- **Route programming**: editors choose what each bus shows, by route, direction, company
  or single bus, with schedules, pins, route notices, a live preview and a change history.
- **One QR per bus**: the magazine opens first, the "How's this bus?" rating comes later in
  the ride; printed stickers in English and Nepali, bulk PDFs, print history.
- **Reading experience**: one-line summaries and key points, folding long stories,
  contents, progress, "Next" and "Up next", continue where you left off, and the stops on
  this road as a timeline in travel order.
- **Duty log and appraisals**: trips with crew, reviews attributed to the crew on board,
  driver scorecards for any period, appraisals with a PDF in English and Nepali.
- **Income and ticket records**: a daily sheet per bus, CSV and XLSX import without
  duplicates, reports with operating profit, reconciliation, behind an authenticator.
- **Public website**: magazine, road guides, places, partners and deals, write a trip,
  advertise; labelled sponsored slots, counted partner links, double opt-in newsletter,
  monthly partner reports; Lighthouse 99/100/100/100 on phones.
- **Partner area** for listed businesses, and partner packages, an enquiry inbox and
  listing verification in the control panel.
- **Security to OWASP ASVS Level 2**: see [SECURITY.md](SECURITY.md).

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
| **Registration** | Register a company (verified by a Batoma admin), then register buses by official registration number. A number is unique across Batoma however it is written (`BA 1 KHA 2345` = `ba-1-kha-2345`), so a bus can't be claimed twice |
| **Dashboard** | Total buses by status, passenger rating and satisfaction, what needs attention, fuel spend, crew, reminders, latest reviews, open breakdowns, and a per-bus performance table |
| **Bus profiles** | Registration number, name, type, seats, make, model, facilities, route, photo, odometer, service intervals; archive and restore |
| **Reviews and feedback** | Every review and private suggestion per bus; rating trend by month, distribution, part scores, lowest-rated buses, words passengers praise and complain about; public replies; report abusive reviews to Batoma |
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
Batoma, companies waiting for verification, and verify, reject or suspend with a reason
the company sees. Held and reported bus reviews appear in Moderation.

**Appearance.** The control panel ships seven colour palettes — Prayer Flag (Batoma's own),
Himalaya Dawn, Teahouse, Rhododendron, Forest Trail, Slate and Night Bus. Pick one under
*Appearance* in the sidebar; the choice is per browser, so each editor keeps their own.

---

## Run it locally

You need Node 22 or newer and PostgreSQL 16 (`docker compose up -d db`, or Postgres.app).

### API

```bash
cd backend
cp .env.example .env          # set JWT_SECRET (openssl rand -base64 48), and for encryption:
                              # FIELD_ENCRYPTION_KEYS="v1:$(openssl rand -base64 32)", BLIND_INDEX_KEY=$(openssl rand -base64 32)
npm install
npx prisma migrate dev
npm run seed                  # demo content and accounts (password BatoDemo#2026)
npm run seed:guides && npm run seed:itinerary && npm run seed:creators
npm run fields:encrypt        # encrypt any personal field written without the keys
npm run start:dev             # http://localhost:3000/api/v1
```

With no SMTP or SMS gateway configured, confirmation links and sign-in codes are returned
in the API response (`devLink`, `devCode`) and shown on the sign-in pages, so everything
works without credentials. Production refuses to start in that state.

### Web app

```bash
node scripts/dev-web-server.mjs   # http://localhost:5173, from the repository root
```

It rewrites `/b/<code>` and `/r/<code>` to the reader and proxies `/api/*` to the API, as
Render does, and sends the same strict security headers.

### Public website

```bash
cd backend                    # add SITE_DB_PASSWORD (openssl rand -hex 16) and SITE_API_KEY to .env first
npm run db:site-role          # the website's read-only role, with that password
cd ../site
cp .env.example .env          # DATABASE_URL with that password, SITE_API_KEY as in backend/.env
npm install && npm run build
node --env-file=.env dist/src/server.js   # http://localhost:4000
```

### Test accounts and demo bus companies

```bash
cd backend
TEST_ACCOUNTS_FILE=../Bato_Test_Accounts.md npm run accounts:test
npm run seed:trips && npm run seed:income
```

Creates shareable accounts and writes them, with passwords, authenticator keys and bus QR
test links, to the file (keep it out of git):

| Account | Use |
|---|---|
| `tester.admin@`, `tester.editor@`, `tester.moderator@bato.test` | Control panel (with authenticator) |
| `owner.fleet@bato.test` | Owner of *Himalayan Express Travels*: 6 buses with records, crew, trips, income and reviews |
| `manager.fleet@bato.test`, `crew.fleet@bato.test` | Manager and conductor at the same company |
| `owner.single@bato.test` | Owner of *Shrestha Yatayat*, one bus |
| `owner.pending@bato.test` | Owner of *Pokhara Night Riders*, waiting for verification |
| `traveller@bato.test` | Passenger account |

### Tests

```bash
cd backend
npm run typecheck                    # tsc, and strictNullChecks over the Phase 3 modules
npm test                             # 254 unit tests over the pure logic
npm run test:db && DATABASE_URL=postgresql://travel:travel@localhost:5432/batoma_test npm run test:e2e   # IDOR suite
for s in fleet programming trips qr appraisal income site security; do
  bash scripts/${s}_smoke.sh ../Bato_Test_Accounts.md   # API smoke suites, against a running API (THROTTLE_DISABLED=true)
done
cd ../site && npm test               # the website: crawler, ad slots, counted links, forms, purge
```

GitHub Actions runs all of these (except the smoke suites, which need demo data) on every
push, plus `npm audit` and an OWASP ZAP baseline scan of the running services.

---

## Deploy

Follow **[GO_LIVE.md](GO_LIVE.md)**: domains, accounts (Render, Cloudflare R2, an email
provider), the blueprint, DNS, the first admin, the first sticker, `scripts/prod_smoke.sh`,
backups and monitoring, and how to roll back.

`render.yaml` creates `bato-api`, `bato-web` (the app, with `/api/*` rewritten to the API),
`bato-site` (the website on the main domain, which also hands sticker links to the app),
a managed Postgres with point-in-time recovery, and a weekly encrypted backup job. Files
live in R2 buckets; the API refuses to start in production without them.

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
| `/programming` | Route programming: placements, preview, history, notices (editors) |
| `/fleet/...trips`, `/fleet/appraisals`, `/fleet/drivers/:id/scorecard` | Duty log, appraisals, scorecards |
| `/fleet/companies/:cid/income…`, `/fleet/buses/:id/income/:date` | Income records, imports, reports |
| `/fleet/companies/:id/documents`, `/businesses/:id/documents`, `/admin/verification-documents` | Verification documents (private) |
| `/businesses/:id/leads`, `…/report(.csv|.pdf)`, `…/coupons`, `coupons/:id/end` | Partner area |
| `/site/*` | The website's forms (with its key only) and public audience figures |
| `/admin/partner-packages`, `/admin/site/*`, `/admin/security-events` | Control panel: packages, enquiries, newsletter, security events |
| `/users/me/export`, `DELETE /users/me` | A person's own data, and deleting their account |
| `/auth/mfa/recover`, `/auth/mfa/recovery-codes`, `/auth/logout-all` | Recovery codes, sign out everywhere |
| `/health` | liveness and database check (outside the API prefix) |

---

## Security

See [SECURITY.md](SECURITY.md) (what is protected, keys and rotation, backups and restore,
retention, monitoring, incidents, reporting a vulnerability) and
[THREAT_MODEL.md](THREAT_MODEL.md) (STRIDE across scans, reviews, finance, partner links,
uploads and the website). In short: argon2id passwords with lockout and a common-password
check; authenticators for staff and finance owners with recovery codes; personal fields
encrypted at rest; private files behind five-minute signed links; every picture re-encoded
without metadata; no inline script anywhere and a strict Content-Security-Policy; an IDOR
suite over every fleet, finance and partner route; redacted logs; 13-month retention.

## What is not done

[GAPS.md](GAPS.md) lists what is unfinished, with an effort estimate for each.
