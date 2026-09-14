# QR Travel Magazine & Tourism Platform

A full implementation of the feature specification: a Nepali travel magazine reached
by scanning a QR code on a bus seat-back, with a traveller blog, offline maps,
itinerary builder and a paid listing platform for tourism businesses.

Two parts:

| Folder | What it is |
|---|---|
| `backend/` | NestJS + Prisma + PostgreSQL API — 74 TypeScript files, 15 modules, 42 database models |
| `web/` | Installable PWA front end — single-file, offline-first, "Prayer Flag" design system |

---

## 1. Start the database

```bash
docker compose up -d db
```

Or point `DATABASE_URL` at any PostgreSQL 14+ instance.

## 2. Set up the backend

```bash
cd backend
cp .env.example .env          # then edit JWT_SECRET before deploying anywhere
npm install
npx prisma generate           # required — see note below
npx prisma migrate dev --name init
npm run seed
npm run start:dev
```

The API comes up on `http://localhost:3000/api/v1`.

> **Note on `prisma generate`.** This step downloads Prisma's query engine binary
> from `binaries.prisma.sh`. That domain was blocked in the environment where this
> code was written, so the client could not be generated there. Everything else was
> typechecked against a generated stub and compiles clean. Run the command above on
> your own machine and it will complete normally.

## 3. Serve the front end

```bash
docker compose up -d web      # http://localhost:5173
```

Or any static server — `npx serve web`, `python3 -m http.server`. It must be served
over HTTP (not `file://`) for the service worker to register.

## 4. Sign in

### Travellers — two steps

The SMS gateway is optional. With `SMS_GATEWAY_URL` left blank, the OTP is returned
in the API response as `devCode` instead of being sent.

```bash
curl -X POST localhost:3000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' -d '{"phone":"9800000001"}'
# → { "data": { "devCode": "123456", ... } }

curl -X POST localhost:3000/api/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"9800000001","code":"123456"}'
```

### Admins, editors, moderators and operators — three steps

Privileged roles cannot sign in with an SMS code alone. SIM-swap against one
number would otherwise hand over the entire platform, so these accounts require
an authenticator app (TOTP) as a second factor.

On first sign-in, `otp/verify` returns a `challengeToken` instead of a session:

```bash
# 3a. Start enrolment — returns an otpauth:// URI to scan
curl -X POST localhost:3000/api/v1/auth/mfa/enrol/start \
  -H 'Content-Type: application/json' -d '{"challengeToken":"..."}'

# 3b. Confirm with the code from Google Authenticator or Authy
curl -X POST localhost:3000/api/v1/auth/mfa/enrol/confirm \
  -H 'Content-Type: application/json' -d '{"challengeToken":"...","code":"123456"}'
```

Afterwards the third step is simply:

```bash
curl -X POST localhost:3000/api/v1/auth/mfa/verify \
  -H 'Content-Type: application/json' -d '{"challengeToken":"...","code":"123456"}'
```

If an admin loses their device, another admin runs
`PATCH /users/:id/reset-mfa`, which is written to the audit log.

### Seeded accounts

| Phone | Role | Sign-in |
|---|---|---|
| 9800000001 | Admin | OTP + authenticator |
| 9800000002 | Editor | OTP + authenticator |
| 9800000003 | Moderator | OTP + authenticator |
| 9800000004 | Business owner | OTP only |
| 9800000005 | Contributor | OTP only |

### Demo QR sticker

Short code **`DEMO2024`** — a seat-back sticker on the Kathmandu–Pokhara route,
seat 12, operator Ganapati Deluxe. This is what the PWA scans on load.

```bash
curl -X POST localhost:3000/api/v1/qr/r/DEMO2024 \
  -H 'Content-Type: application/json' -d '{"sessionId":"test-device"}'
```

---

## What the QR scan returns

`POST /qr/r/{shortCode}` is the centre of the product. One unauthenticated call
returns everything the reader needs before the bus leaves the park:

- the operator and vehicle, for co-branding
- the route, so the content is corridor-specific
- the current issue and every article linked to that corridor
- businesses that paid to target that corridor, highest tier first
- the **offline pack manifest** — the article list the service worker pre-caches
- app store links, with `promptInstallFromSession: 2` so the install banner never
  appears on the first scan

## API surface

| Prefix | Module | Notable endpoints |
|---|---|---|
| `/auth` | Phone OTP, JWT, rotating refresh tokens | `otp/request`, `otp/verify`, `refresh` |
| `/qr` | Sticker resolution and analytics | `r/:code`, `batch`, `stats` |
| `/magazine` | Issues, articles, categories | `current-issue`, `articles/:slug`, `elevate` |
| `/posts` | Traveller blog | `publish`, `map-pins`, `:id/submit` |
| `/engagement` | Reactions, bookmarks, comments | `bookmarks`, `comments` |
| `/places` | POIs, destinations, map packs | `nearby`, `bounds`, `map-packs`, `altitude-check` |
| `/itineraries` | Trip planner | `from-article`, `suggest`, `:id/fork`, `permits` |
| `/businesses` | Listings, coupons, leads | `:id/lead`, `:id/dashboard`, `coupons/:id/claim` |
| `/operators` | Routes, vehicles, ride feedback | `feedback`, `:id/dashboard`, `lost-items` |
| `/moderation` | Trust & safety | `report`, `queue`, `act`, `audit` |
| `/safety` | Emergency directory, SOS | `directory`, `sos` |
| `/media` | Image upload | `upload` |
| `/admin` | Platform dashboard (ADMIN only) | `overview`, `subscriptions`, `audit-log` |
| `/health` | Liveness and database check | `GET /health` (outside the API prefix) |

Every successful response is wrapped as `{ "success": true, "data": ... }`.

---

## Security

**The application refuses to start on an unsafe configuration.** `src/config/env.validation.ts`
runs before anything else and halts the process on a placeholder or short `JWT_SECRET`,
a missing SMS gateway in production, an absent or wildcard `CORS_ORIGINS`, or a
non-HTTPS public URL. The two worst failure modes here were silent, so they are now
startup failures instead.

**Login codes are never returned over the API in production.** In development, with no
SMS gateway configured, the OTP comes back as `devCode` so you can work without
credentials. That path is unreachable in production because the app will not boot
without a gateway.

**Second factor for anyone with power.** ADMIN, EDITOR, MODERATOR and OPERATOR_ADMIN
must enrol TOTP. Challenge tokens are scoped and are rejected by the JWT strategy if
presented as a session token, so the second factor cannot be bypassed by calling the
API with the challenge directly.

**Refresh tokens rotate with reuse detection.** Every token from one login shares a
`familyId`. Presenting an already-revoked token means it was captured, so the entire
family is revoked and both parties are logged out. The legitimate user signs in again;
the attacker gets nothing.

**Privilege changes are audited and invalidate sessions.** `setRole` writes a
`CHANGE_ROLE` entry and revokes every refresh token for that account, so an elevated
role cannot be exercised from a token minted under the old one. Admins cannot change
their own role.

**Uploads are validated by file signature, not extension.** The filename is
attacker-controlled, so it is discarded and replaced with a UUID, and the first bytes
are checked against real JPEG, PNG, WebP and AVIF magic numbers. Anything else is
deleted from disk immediately. A restrictive CSP covers the static path as well.

Remaining hardening worth doing before a public launch: move uploads to a separate
origin or CDN so they never share the API's domain, turn on `strictNullChecks`, and
add integration tests around the auth flow.

## Correctness fixes worth knowing about

**Offline packs use absolute URLs.** The API previously returned relative paths
(`/api/v1/...`). A service worker resolves those against the *page* origin, and the
API normally runs on a different host or port, so every cached fetch was a 404 that
was silently discarded — while the reader was still told their stories were saved.
The manifest now builds URLs from `API_PUBLIC_URL`, the worker caches with explicit
CORS and counts only successes, and the UI reports what is actually on disk. This
was the worst defect in the system, because offline reading is the product's entire
reason to exist.

**Paid placement now expires.** `SubscriptionsTask` runs nightly at 02:00 Kathmandu
time: it warns owners seven days out and downgrades lapsed listings to FREE,
withdrawing route-corridor targeting with them. Previously `subscriptionEndsAt` was
written and never read, so one month's payment bought permanent premium ranking.
Every change is recorded in `SubscriptionEvent` so a billing dispute can be answered
from the record.

**Coupon claims are atomic.** The claim now runs inside a transaction that takes a
row lock on the coupon (`SELECT ... FOR UPDATE`). Checking the count and then
inserting let simultaneous requests both pass the limit, which made `maxRedemptions`
advisory — a problem when a business has agreed to honour a fixed number of
discounts. `validFrom` is now enforced too; it was on the model and never checked.

**Radius search paginates correctly.** Filtering by distance in JavaScript *after*
paginating in SQL meant a page of twenty could return three while the total claimed
hundreds, and later pages skipped businesses. A bounding box narrows rows using the
coordinate indexes, the exact haversine runs on that set, and page and count now
share one predicate.

**Scan lookups are indexed.** `resolve()` runs on every scan and checked
`count({ sessionId })` against an unindexed column — a full table scan on the
hottest path in the system. It is now an indexed existence check, and unique-device
totals use `COUNT(DISTINCT ...)` in SQL rather than loading every row into Node.

## Decisions worth knowing about

**Offline is the architecture, not a feature.** The QR resolve response carries a
pack manifest; the service worker pre-caches it on the spot. API requests are
network-first with a cache fallback, images and shell are cache-first. Nothing in
the reading path requires a connection.

**Route-aware content is the moat.** `ArticleRoute` and `BusinessRouteTarget` are
join tables specifically so a Prithvi Highway reader gets Prithvi Highway content —
that is what makes a Bandipur homestay willing to pay for placement.

**Coupons exist for attribution, not discounts.** `CouponRedemption` issues one row
per claimed code and records when it was redeemed at the counter. This is the proof
shown on the business dashboard that the platform sent a real customer, and it is
what makes the listing renewable.

**Ride feedback is anonymous by design.** A passenger will not rate the driver
honestly with their name attached, and honest per-vehicle data is the only reason an
operator agrees to free seat-back placement.

**Moderation is built in, not bolted on.** Reporting, blocking, filtering and an
append-only `ModerationEntry` audit trail are present because Apple Guideline 1.2
rejects user-generated-content apps that lack them at first submission.

**Solo-traveller privacy.** `hideExactLocation` fuzzes published coordinates to
roughly 1.1 km for everyone but the author, and `publishDelayHours` can hold a
geotagged post back so a location is never broadcast in real time.

**Separation of concerns on money.** Route targeting is rejected for `FREE` tier
businesses at the service layer, and photo limits differ by tier.

---

## Front end

`web/index.html` is a single file implementing the spec's design system:

- Full "Prayer Flag" palette as CSS custom properties
- Three themes: **day**, **night bus** (deep purple-black, no pure white — long
  routes run overnight), **bright sun** (maximum contrast for a window seat)
- Reduced-motion toggle, because winding roads make animation genuinely unpleasant
- 17px body text at 1.6 line height and 48px tap targets, sized for a vibrating vehicle
- Bottom-anchored navigation for one-thumb reach
- Listen mode presented as a primary feature, not accessibility polish
- Mukta for body text — it covers Devanagari and Latin in one family
- Install banner gated on `sessionCount() >= 2`

It talks to the API when reachable and falls back to bundled demo content mirroring
the seed, so the whole flow demos with no backend running.

---

## Before production

1. Set a real `JWT_SECRET` (`openssl rand -base64 48`), configure the SMS gateway and
   set `CORS_ORIGINS`. The app will not start in production without all three.
2. Move uploads from local disk to S3-compatible storage behind a CDN — bandwidth is
   the largest recurring cost of a photo-heavy travel product.
3. Add real MBTiles map packs and update `MapPack.downloadUrl`.
3b. Set `API_PUBLIC_URL` to the host phones actually reach. If it is wrong,
   offline packs cache nothing — production refuses to start without it.
4. Generate the TTS audio files that `Article.audioUrl` points at.
5. Add PWA icons at `web/icons/icon-192.png` and `icon-512.png`.
6. Start the D-U-N-S application now if native apps are on the roadmap — Apple
   organisation enrolment needs it and the lead time in Nepal is long.

`backend/.typecheck/` is a sandbox artifact used to typecheck without the Prisma
client. Delete it once `npx prisma generate` has run.
