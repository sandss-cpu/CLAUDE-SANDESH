# Decisions

Choices made while building Batoma Phase 3 that someone reading the code later would
otherwise have to guess at. Newest last within each section. Things only the product
owner can decide (domains, legal wording, prices) are not here; they are asked.

## Working arrangement

- **Phase 3 lives on the `phase3` branch** of the GitHub repository, built in
  `~/Desktop/COASTER.2019/travel-platform 3`. `main` and the other local copies are
  untouched until the owner decides to merge.
- **Its own database, `batoma_phase3`.** Phase 3 migrations retire a table and encrypt
  columns; running them against the shared `travel_magazine` database would break every
  other copy that still runs the old code.

## Dependencies

- **NestJS 11, not 12.** NestJS 12 is the current major, but it ships as ES modules only
  (`"type": "module"`). Moving the backend, its Jest set-up and the ts-node seed scripts to
  ESM is a large change with no security benefit: the latest 11.x (11.2.7) is outside
  every advisory range, and with Express 5, multer 2.4 and nodemailer 10 `npm audit
  --omit=dev` reports nothing. The brief allows "NestJS 11 (or the current LTS)".
- **nodemailer 10** publishes a CommonJS build beside its ESM one, so it is required as
  before, and it brings its own types (`@types/nodemailer` removed).
- **`@nestjs/jwt` 11 types `expiresIn` as a duration string** rather than any string. The
  configured `JWT_EXPIRES_IN` is cast to that type at the two places it is read; a value
  jsonwebtoken cannot parse still fails at sign-in, as it did before.
- **Prisma stays on 5.** Prisma 7 changes how the client connects (driver adapters) and
  has no outstanding advisory against 5.22, so it is not worth the risk mid-build.

## Cross-cutting rules for Phase 3 code

- **One audit table (`AuditEvent`)** for admin and finance changes, written through
  `AuditService.record()`. `ModerationEntry` stays the moderation trail.
- **No inline scripts or handlers in pages that are touched.** Each page's script moves to
  `web/js/`, and `onclick="fn(...)"` becomes `data-action="fn"` handled by one delegated
  listener that accepts only whitelisted names. A strict CSP can then be switched on
  page by page.
- **Money is integer paisa** in new tables. Existing fuel, maintenance and repair costs
  are whole-rupee integers; they are left as they are and multiplied by 100 where reports
  combine them with income.

## Step 2: scanning, offline and the reader

- **Demo content only with no code and no API.** The reader runs in one of six modes
  (`loading`, `live`, `cached`, `offline`, `inactive`, `demo`). Bundled stories,
  businesses and the sample trip appear only in `demo`. A real code with no signal and
  nothing saved shows "Waiting for signal", never another route's stories.
- **The last scan answers for 12 hours** when the URL carries no code: someone who signs
  in, or reopens the app from the home screen, is still on their bus. Each code's last
  answer is kept regardless of age, so re-scanning the same sticker with no signal works.
- **A route with no programmed stories shows the current issue.** Step 3 moves this into
  the server's content resolution (the DEFAULT level).
- **Archived buses' codes return "not active"** from `resolve()` too, matching the public
  profile. **An unverified company is not named on a scan**, but its bus still opens the
  route magazine: the content is Batoma's, and a freshly registered company's stickers
  should not show an error.
- **Offline map packs are hidden, not faked.** Nothing renders tiles and the seeded packs
  point at example URLs. The tab became **Road**: the road guide for this route in the
  direction of travel, which is real, editor-written and cached for offline.
- **Direction of travel is asked once per route and remembered for 12 hours**
  (`bato.direction`). Step 3 adds the same choice to the masthead and sends it to the
  server; an active trip will override it.
- **REVERSE guides count distance from the traveller's start.** Stops are still stored
  once, in forward order; the service flips distance and time using the route's length.
  A route with no length shows no distance, rather than a wrong one.
- **The install banner needs a real store link.** No native app exists yet, so with no
  `APP_STORE_URL` or `PLAY_STORE_URL` configured it never shows.
- **Saved stories are a list on the phone** (`bato.saved`), not the server's bookmarks.
  They work signed out and offline. Syncing them to `/engagement/bookmark` for
  signed-in readers is listed in GAPS.md with the rest of the engagement UI.
- **`style-src` keeps `'unsafe-inline'`.** The brief's strict CSP is about scripts; the
  pages build markup with inline `style` attributes everywhere, and those cannot run
  code. `script-src` drops `'unsafe-inline'` page by page as each page's handlers move.

## Step 3: route programming (Feature 1)

- **Level before pin.** `contentFor` orders by level first (bus, company, route this way,
  route both ways, every bus, current issue), and only then by pin and position within a
  level. Pinning across all levels would let a route's pinned lead outrank a bus's own
  programme, and the acceptance test is that a bus-level override wins and removing it
  restores the route's list.
- **The current issue is the last level**, after the DEFAULT placements, so a route with
  nothing programmed still has a magazine. The reader's own "current issue" fallback from
  step 2 now rarely runs.
- **Company and bus placements may carry a route.** Made from the route view, they apply
  only while that bus (or the company's buses) runs that road; a bus moved to another
  route stops showing them. Without a route they apply wherever the bus goes.
- **DEFAULT has no direction**, enforced in SQL (`placement_target`) and in the service.
- **One article per slot** (`placement_slot`, an expression index Prisma cannot see). A
  second schedule for the same story in the same list is an edit, not a copy.
- **The admin list shows the reader's order**, with the same tie-breaks (featured, then
  newest), so dragging starts from what travellers see.
- **Choosing a direction re-asks with `refresh: true`**, which the server does not count as
  a new scan. A direction chosen on one bus applies to every bus on that route for 12
  hours. An active trip (step 4) will take precedence over the traveller's choice.
- **The offline pack carries a programme version.** A phone that already saved that version
  completely does not download it again on a re-scan; a changed programme is fetched the
  next time there is signal.
- **The admin preview ignores a company filter.** A traveller is on one bus, so the preview
  is either a route (before overrides) or one bus (exactly what it shows).
- **Route notices are bilingual and never dismissible.** They are safety information,
  shown for the route and direction while their window is open.
- **Times are entered and shown in Asia/Kathmandu** in the control panel, whatever the
  editor's computer is set to.

## Step 4: the duty log (Feature 5, part one)

- **Crew accounts are company members with a CREW role**, not a separate login system.
  They reach the duty screen (`DUTY` access level) and get 403 everywhere else; company
  emails go to owners and managers only.
- **Two taps from the duty screen**: the bus's direction button, then confirm. The crew is
  the bus's current roster; a crew account cannot change it (owners and managers can, on
  the Trips screen). Choosing nobody for every job falls back to the roster.
- **A review is pinned to the moment of the scan** (the scan token's issue time), not the
  moment it is sent: passengers often review after getting off. In order: the trip
  running then; a trip that left within the hour after (boarding at the park before the
  conductor tapped Start); the roster then; nobody ("crew unknown").
- **An unended trip stops counting after 24 hours**, for reviews and for the reader's
  direction, so one forgotten "End trip" cannot attribute every later review to that
  driver. The duty screen flags it.
- **Trips lock 48 hours after departure.** Owners reopen one for 24 hours with a reason,
  which is audited. Ending a trip is always allowed: it completes the record.
- **Late logging up to 48 hours, early by up to an hour.** Older trips are corrected by an
  owner, not started.
- **An odometer reading at arrival moves the bus's odometer on** (never back), which keeps
  service reminders honest.
- **Crew roles are not enforced per slot.** A small company's driver may also take fares;
  the trip records who sat in which seat as the office tells it.
- **Pre-filled "now" times are sent as no time at all**, so the server stamps them to the
  second. `datetime-local` drops seconds, and a trip ended in the minute it began
  "arrived" before it left.
- **BS dates come from a vendored table** (BS 2000–2090, nepali-date-converter, MIT) in
  `bs-date.ts`, with a browser copy generated by `scripts/sync-web-libs.mjs`. Instants
  are read as the Kathmandu day before converting. Outside the table the BS date is left
  out rather than guessed.
- **`THROTTLE_DISABLED` switches rate limits off for local test runs only.** The smoke
  suites sign in many accounts back to back; production refuses to start with it set.
