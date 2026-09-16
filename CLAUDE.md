# CLAUDE.md

Context for AI assistants working in this repository. Read this before changing code.

## What this is

**Bato** — a Nepali travel magazine reached by scanning a QR code stuck to a bus
seat-back, plus a traveller vlog feed with voting, offline maps, an itinerary builder,
newspaper-style ad slots, a paid listing platform for tourism businesses, and a bus
owner portal where companies register buses, keep service and document records, manage
crew and fuel, and read passenger reviews of each bus.

The full product specification lives in `QR_Travel_Magazine_Feature_Spec.md` at the
repository root. When a decision here seems arbitrary, the spec usually explains it.

| Path | What it is |
|---|---|
| `backend/` | NestJS 10 + Prisma 5 + PostgreSQL |
| `web/index.html` | Single-file installable reader PWA. Offline-first |
| `web/login.html` | Email / phone sign-in, sign-up, password reset, email-link landing |
| `web/admin.html` | Control panel: articles, issues, ads, bus companies, moderation, users, overview |
| `web/bus.html` | Public bus page: search, bus QR landing, rating, reviews, review form |
| `web/creator.html` | Creator directory, public profiles, journeys, and the creator's own panel |
| `web/owner.html` + `owner-*.js` | Bus owner portal. Split into script files because it is large; keep them classic scripts sharing globals, loaded in order |
| `web/config.js` | API address; overwritten by the Render static-site build |
| `render.yaml` | Deployment blueprint (Postgres, API with uploads disk, static site) |

## Commands

Run everything from `backend/` unless stated otherwise.

```bash
docker compose up -d db        # from the repo root
npm install
npx prisma generate            # required after any schema change
npx prisma migrate dev --name <change>
npm run seed                   # demo accounts; email password BatoDemo#2026
npm run seed:prod              # production: categories + first admin from ADMIN_* env vars
npm run start:dev              # http://localhost:3000/api/v1
npm run build                  # uses tsconfig.build.json → dist/main.js
```

Never run `npm audit fix --omit=dev`: it prunes dev dependencies from `node_modules`,
and `npx tsc` then silently downloads an unrelated package named `tsc`. Run
`npm install` to restore them, and prefer `./node_modules/.bin/tsc`.

Health check is at `/health`, deliberately outside the `api/v1` prefix.

There is **no unit test suite**. `scripts/fleet_smoke.sh <accounts file>` runs 113 API
checks against a running local API, using the accounts from `npm run accounts:test`.
Write request bodies into a variable before `"$(call …)"`: macOS's bash 3.2 mangles
escaped quotes written directly inside command substitution.

```bash
TEST_ACCOUNTS_FILE=../Bato_Test_Accounts.md npm run accounts:test   # test accounts + demo bus companies
npm run seed:guides            # demo route guides
npm run seed:creators          # demo approved creator with a journey
bash scripts/fleet_smoke.sh ../Bato_Test_Accounts.md
```

## Environment traps

`src/config/env.validation.ts` runs before the app starts and **halts the process**
on an unsafe configuration. This is intentional — the two worst misconfigurations in
this system used to be silent.

- `JWT_SECRET` must be 32+ chars and not the example placeholder
- In production: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `CORS_ORIGINS`
  (no wildcard), and HTTPS `PUBLIC_WEB_URL` and `API_PUBLIC_URL` are mandatory
- `PHONE_LOGIN_ENABLED` defaults on in development and off in production. When on in
  production, `SMS_GATEWAY_URL` and `SMS_GATEWAY_TOKEN` become mandatory
- With no gateway in development, the OTP comes back as `devCode` and email links as
  `devLink`. Production cannot reach that state because it refuses to boot
- `TRUST_PROXY` is a hop count (0 locally, 1 on Render). At 0 behind a proxy, every
  visitor shares one IP for rate limits and report counting. Never set it to `true`:
  with no proxy in front, clients could choose their own IP
- `MEDIA_BASE_URL` must match where uploads are served. Posts and ads only accept
  image URLs of the form `MEDIA_BASE_URL/<uuid>.<ext>`

**`API_PUBLIC_URL` matters more than it looks.** Offline packs are cached from it.
Set it wrong and offline reading fails silently while still reporting success — see
"Landmines" below.

## Architecture

Standard NestJS layering: `controller` → `service` → `PrismaService`. DTOs use
`class-validator`, and `ValidationPipe` runs with `whitelist: true`, so a field
absent from the DTO is stripped from the request rather than reaching the service.

Global providers, in order: `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard`, plus
`AllExceptionsFilter` and `TransformInterceptor`.

**Every response is wrapped** as `{ success: true, data: ... }`. The interceptor also
serialises `BigInt` to string, which matters for `MapPack.sizeBytes`.

Routes are authenticated by default. Opt out with `@Public()`, or `@OptionalAuth()`
when a signed-in user should be recognised but anonymous access is still allowed.

### Modules

`auth` `users` `qr` `magazine` `posts` `engagement` `places` `itineraries`
`businesses` `operators` `moderation` `safety` `media` `admin` `ads` `fleet` `guides`
`creators` `health`

- **auth**: every sign-in method ends in `completeSignIn()`, which blocks suspended
  accounts and sends privileged roles to the authenticator step. Add new methods
  through it, never around it
- **posts**: publish-first. A post goes live immediately unless `needsReview()`
  (`common/utils/content-filter.ts`) flags it; votes live in `PostVote`, separate from `Reaction`
- **ads**: status (active / scheduled / paused / expired) is derived from dates plus
  `isActive`, never stored. MONTH runs clamp to the month's last day
- **moderation**: reports de-duplicate per person; three distinct people auto-hide a live
  post, comment or bus review. People are counted by account, or for anonymous reports by `ipHash`
- **fleet**: the bus owner portal. `Operator` is a company (an individual owner is a
  company with one bus), `Vehicle` a bus, `RideFeedback` a passenger review. Controllers:
  `fleet` (owner portal, signed in), `buses` (public), `fleet/admin` (admin). Access is
  decided by `OperatorAdmin` membership in `FleetAccessService`, never by `User.role`:
  OWNER or MANAGER, and non-members get 404. Every service method calls
  `access.company()` or `access.bus()` first; new endpoints must too
- **ads**: twelve placements, and `AdRouteTarget` aims an ad at corridors. `slot()` serves
  targeted ads first and fills the rest with untargeted ones; an ad targeted elsewhere
  never appears, and with no `routeId` only untargeted ads show
- **guides**: `RouteGuide` + `RouteGuideStop` are what an editor curates along a route.
  Stops are always stored in the route's forward order; a `BOTH` guide is reversed when
  read in the REVERSE direction, so never store a second reversed copy
- **creators**: `CreatorProfile` is only public once an admin sets `APPROVED`;
  `CreatorJourney` groups the creator's own `Post` rows through `CreatorJourneyPost`, so
  entries keep their votes, comments and moderation state rather than being copies

`qr.resolve()` is the centre of the product. One unauthenticated call returns the
operator, route, corridor-specific articles, corridor-targeted businesses, the
offline pack manifest and the app store links. Treat it as the hottest path in the
system and be careful what you add to it.

## Conventions

- British spelling in user-facing strings and comments (`recognise`, `behaviour`)
- Comments explain **why**, not what. If a line needs a comment to say what it does,
  rewrite the line
- Currency is NPR, formatted `NPR 2,500 – 5,000`
- Nepali phone validation: `/^(?:\+?977)?(9[678]\d{8})$/`
- Short codes use an alphabet with no `0`, `O`, `1` or `I` — they get read off a
  sticker in a moving vehicle (`common/utils/slug.util.ts`)
- Ownership is enforced in the **service** via `assertOwner`, never only at the route
- Literal route paths must be declared **before** parameterised ones. `admin/directory`
  sits above `:id`, `admin/pending-verification` above `:slug`

## Landmines

Things that have already caused real bugs here. Do not undo them.

**Offline pack URLs must be absolute.** A service worker resolves relative paths
against the *page* origin, not the API's. When these were relative, every cached
fetch 404'd and was silently discarded while the UI still reported "42 stories
saved". The worker now caches with explicit CORS and counts only verified successes.
Offline reading is the product's entire reason to exist; do not let it fail quietly.

**`prisma generate` needs network access** to `binaries.prisma.sh`. In restricted
sandboxes it fails. The workaround used during development was a generated type stub
under `.typecheck/` — regenerate it by parsing `schema.prisma` if you need to
typecheck without the real client, and delete it before shipping.

**Radius search filters in SQL, not JavaScript.** Paginating first and filtering by
distance afterwards made page and count disagree — twenty requested, three returned,
total claiming hundreds. A bounding box narrows rows, the haversine refines, and both
page and count use the same predicate.

**Coupon claims hold a row lock.** `SELECT ... FOR UPDATE` inside a transaction.
Check-then-insert let concurrent requests exceed `maxRedemptions`, which matters when
a business has agreed to honour a fixed number of discounts.

**`ScanEvent.sessionId` is indexed** because `resolve()` queries it on every scan.
Use `findFirst` for existence, never `count`. Unique-device totals use
`COUNT(DISTINCT ...)` in SQL — do not pull rows into Node to read `.length`.

**Privileged roles require TOTP.** ADMIN, EDITOR, MODERATOR and OPERATOR_ADMIN cannot
sign in with an SMS code alone. Challenge tokens carry a `scope` claim and
`JwtStrategy` rejects any scoped token presented as a session, so the second factor
cannot be bypassed by calling the API with the challenge directly.

**`Post.clientDraftId` has its own column.** It used to be stuffed into
`moderationNote`, where a moderator writing a note destroyed the idempotency key and
a replayed offline draft duplicated.

**The service worker serves pages network-first** (3-second fallback to cache). It was
cache-first, so a deploy never reached anyone who had visited before. Pages,
`sw.js` and `config.js` are also served `no-cache` by `render.yaml`.

**Refresh tokens are single-use, so refresh one at a time.** The web apps serialise
refreshes with `navigator.locks` across tabs. Two tabs refreshing with the same token
look like token theft, and the server ends the whole session.

**Moderation `act()` uses `updateMany` / `deleteMany`.** A plain `update` on content
that was already deleted threw, rolled back the transaction, and left its reports
stuck open. Keeping a reported post preserves its `publishedAt`, so it doesn't jump to
the top of the feed. Dismissing a report never publishes a draft article or switches a
business back on.

**Never put user text straight into an inline `onclick`.** `JSON.stringify(title)`
inside a double-quoted attribute ends the attribute at the first quote; that button
never worked. Pass an id and look the text up.

**Registration numbers are unique through `Vehicle.plateKey`.** `normalisePlate()` in
`fleet/fleet.util.ts` upper-cases, converts Devanagari digits and strips everything but
letters and digits. The migration backfilled existing rows with the same rule in SQL; if
you change one, change both, or the same bus can be registered twice.

**Nothing about a company is public until it is verified.** Public bus queries filter on
`operator.verification = VERIFIED` and `isActive`; QR scans check the same. Changing a
verified company's name or registration number resets it to PENDING.

**Bus review scan tokens are scoped JWTs.** `POST /buses/scan/:code` (and a seat-sticker
`qr.resolve()`) returns a 12-hour token with `scope: 'bus-review'` bound to one bus
(`vid`) or one company (`oid`). A review needs that token or a signed-in account with a
confirmed email or phone. Don't dedupe anonymous reviews by IP alone: Nepali mobile
carriers put a whole bus behind one address.

**Reminder dedupe keys include the due date and stage.** `FleetService.reminders()` builds
keys like `svc:<bus>:<date>:<km>:OVERDUE`, so the 06:00 job notifies once per stage.
Renewing a document or recording a routine service marks the matching reminders read.

**After a backend change, check which process holds port 3000.** `nest start --watch`
restarts can hit EADDRINUSE and leave the old process serving stale code. Restart
by killing whatever `lsof -ti :3000` returns.

## Domain rules that look like bugs but are not

- **Bus reviews are anonymous to the owner.** A passenger will not rate a driver honestly
  with their name attached. `ownerReviewView()` never includes `userId`, `sessionId` or
  `ipHash`, and moderators' previews don't either
- **Owners can't delete reviews.** They reply publicly or report to Bato; otherwise the
  ratings would only ever go up
- **Bus company verification is manual**, for the same reason as business verification
- **Coupons exist for attribution, not discounts.** `CouponRedemption` is the proof
  shown on the business dashboard that the platform sent a real customer. It is what
  makes a listing renewable
- **Business verification is manual.** One fraudulent listing that harms a tourist is
  an existential reputational event
- **Route targeting is paid-only** and is deleted on downgrade
- **Solo-traveller privacy**: `hideExactLocation` fuzzes published coordinates to
  ~1.1 km for everyone but the author; `publishDelayHours` can hold a geotagged post
  back so a location is never broadcast live
- **Moderation is not optional polish.** Reporting, blocking, filtering and the
  append-only `ModerationEntry` trail exist because Apple Guideline 1.2 rejects
  user-generated-content apps that lack them at first submission
- **The install banner never fires on the first scan.** Forcing a store visit over
  highway data on a moving bus destroys the funnel's only advantage

## Scheduled work

`SubscriptionsTask` runs nightly at 02:00 Asia/Kathmandu. It warns owners seven days
before expiry, then downgrades lapsed listings to FREE and withdraws route targeting.
Every change is written to `SubscriptionEvent`, which is separate from
`ModerationEntry` because the scheduler has no moderator to attribute an expiry to.

`FleetRemindersTask` runs daily at 06:00 Asia/Kathmandu: due and overdue services,
expiring documents and licences, and open breakdowns become `FleetNotification` rows, and
each company's members get one email summary of what is new. Admins can run it at once
with `POST /fleet/admin/reminders/run`.

## Front end

`web/index.html` is deliberately a single file. It implements the spec's "Prayer
Flag" design system: three themes (day, **night bus**, **bright sun**), a
reduced-motion toggle, 17px body text at 1.6 line height, 48px tap targets and
bottom-anchored navigation. Every one of those is a response to reading on a
vibrating vehicle at night — treat them as requirements, not preferences.

Body font is Mukta because it covers Devanagari and Latin in one family.

It falls back to bundled demo content mirroring the seed when the API is
unreachable, so the whole flow demos with no backend running.

## Known gaps

Real, and worth knowing before you plan work:

1. **Some PWA actions are still toasts only.** Claim coupon and SOS don't call the API
   yet; sign-in, publishing, photos, voting, reporting and rating a bus (via `bus.html`) do
2. **Articles cannot link translations.** `Language` is a field on `Article`, not a
   relationship between versions, so a language toggle needs a schema change
3. **No payment integration.** No eSewa, no Khalti. Tiers and ads are set by hand
4. **No Bikram Sambat dates** anywhere
5. **No unit tests** (only the fleet smoke script), and `strictNullChecks` is off
8. **Company verification has no document upload.** Admins check details by phone or email
6. **Outstanding `npm audit` advisories** need NestJS 12 and nodemailer 10, both major upgrades
7. **No Content-Security-Policy on the web app.** The pages use inline scripts

## Seeded accounts

Demo QR short code: **`DEMO2024`** (Kathmandu–Pokhara, seat 12, Ganapati Deluxe).

Every email account's password is `BatoDemo#2026`. Privileged roles also enrol an
authenticator on first sign-in.

| Email | Phone | Role |
|---|---|---|
| admin@demo.bato.travel | 9800000001 | Admin |
| editor@demo.bato.travel | 9800000002 | Editor |
| moderator@demo.bato.travel | 9800000003 | Moderator |
| business-owner@demo.bato.travel | 9800000004 | Business owner |
| contributor@demo.bato.travel | 9800000005 | Contributor |
