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

## Step 5: one QR per bus (Feature 2)

- **Every active bus has exactly one active BUS code**, enforced by a partial unique index
  (`qr_one_active_bus_code`). The migration gave every bus without one a code in SQL;
  registering a bus, restoring one from the archive and the seed scripts all ensure one.
  The control panel has no "add bus" path to cover: companies register their own buses.
- **The sticker encodes `SHORT_LINK_BASE/b/<code>`**, falling back to `PUBLIC_WEB_URL`.
  That address must never change once stickers are printed, so production insists it is
  https. Rotating a code (audited) leaves the old sticker on the "no longer active" screen
  with a bus search link.
- **Old stickers keep working.** `bus.html?code=` asks the API what the code is without
  counting a scan (`peek`), then sends a bus code to `/b/<code>`; a company code stays on
  that company's page. `/r/<code>` was already rewritten in step 2.
- **Stickers are drawn on the server with pdfkit** and Mukta subsets (latin and
  devanagari) vendored in `backend/assets/fonts`. fontkit shapes Devanagari conjuncts
  correctly, so the print-to-PDF fallback in the plan was not needed. Formats: PDF in A6
  and seat-back (70 × 100 mm), PNG, SVG, and an A4 sheet of the whole fleet. The QR is
  drawn as vector squares, so it stays sharp at any print size. Every download is
  recorded in `QrPrint` and shown as print history.
- **The magazine comes first and the rating second.** "How's this bus?" is offered after
  a finished story or 5 minutes of reading, at the end of every story, under More, and
  once near the journey's end. It snoozes for 45 minutes when dismissed, and does not
  come back for 20 hours once this bus has been rated.
- **Closing the sheet after choosing stars sends the stars.** Part scores, the comment and
  the private suggestion are optional extras, not a form to finish.
- **A rating sent with no signal is queued** on the phone and sent when the signal
  returns, as long as the ride's scan token (12 hours) is still valid. It goes to the
  existing `/buses/:id/reviews`, so every existing rule (one per ride, moderation,
  attribution to the crew) still applies.
- **Scanning from inside the app is its own page, `scan.html`**, so the camera permission
  (`Permissions-Policy: camera=(self)`) covers that page alone. BarcodeDetector where the
  browser has it; elsewhere the vendored jsQR (Apache-2.0), loaded only then. Whatever a
  QR says, the page only goes to this site's own `/b/<code>`.
- **Load time on a weak signal.** Measured with Lighthouse on classic Slow 3G (2 s round
  trip, 400 kbps), mobile, local servers with gzip:

  | | Before | After |
  |---|---|---|
  | Cold first paint | 4.9 s | 2.2 s |
  | Cold LCP (the bus's stories on screen) | 10.4 s | 6.7 s |
  | Cold transfer | 287 KiB | 145 KiB |
  | Warm (service worker) first paint and LCP | – | 0.9 s |

  What changed: fonts are served from this site, not Google (one less connection
  before the first paint, no third party told who reads what); the reader's scripts are
  deferred and its font faces inlined, so the masthead paints as soon as the page
  arrives; `boot.js` starts the scan request while the reader script is still
  downloading; the service worker waits 0.8 s (2G) or 1.5 s (3G) for the network before
  serving the cached page, instead of 3 s.

  **The brief's "under 3 s on Slow 3G" holds for the first paint and for every visit
  after the first, not for the first visit's stories.** At a 2 s round trip, the page,
  then `boot.js`, then the API answer are three round trips, about 6 s, before any
  network content can show. Inline scripts would save one, and the brief rules them out.
  In production the `/api` rewrite (step 11) removes the cross-origin preflight, and
  Render serves the files with Brotli.

## Step 6: scorecards and appraisals (Feature 5, part two)

- **Passenger scores are a Bayesian average with C = 10**, the prior being the company's
  own mean over the same period, computed per score (overall, driving, punctuality,
  staff) because part scores are optional. Under 10 reviews a driver is shown "Not
  enough reviews yet": no score to judge on and no rank. The prior is rounded to two
  places before use; the fixture in `scorecard.spec.ts` works every figure by hand.
- **Reviews count towards whoever the server attributed them to**: the logged trip, or
  the roster at the time. The scorecard says how many came from a logged trip.
- **Fuel is measured per tank, not per trip.** A trip's kilometres are placed in the
  full-to-full stretch their odometer readings fall in (split across a refill), and use
  that stretch's km/l. Two drivers sharing a tank share its figure; the scorecard says
  how many trips the number rests on. The driver is compared with **the same buses**
  driven by anyone, the fair comparison, as well as with the company average the brief
  asks for: a minibus and a coach burn very differently whoever drives.
- **Comment themes come from a word list, not sentiment analysis**: English words (whole
  words, `*` for stems) and Nepali phrases, counted once per review. A negated mention of
  praise ("not safe") counts as the matching complaint. Devanagari has no reliable word
  boundary in a regex, so Nepali phrases match anywhere.
- **Suggested appraisal scores only where the data can speak.** Driving, punctuality and
  conduct come from passenger scores (10 or more of that score); safety from accidents,
  less a point for three or more complaints about unsafe driving; vehicle care from km/l
  against the same buses; attendance from trips against the company's average per
  driver. Anything else is left empty for the owner, never guessed. What the data said
  is frozen into the draft (`suggested`), beside what the owner chose.
- **Owners and managers write appraisals; only owners see the leaderboard.** A final
  appraisal cannot be changed or deleted, only acknowledged once it has been discussed
  with the driver. Every step is audited. SQL checks keep scores in 1–5 and refuse a
  final appraisal with a score missing.
- **Crew disputes go to Batoma moderation** (`ReportReason.WRONG_CREW`). Only the bus
  company can raise one, it never counts towards auto-hiding the review, and a
  moderator settles it by moving the review to another trip of the same bus or to
  "crew unknown". The stars and words stay as written; the reviewer is never shown.
  Owners still cannot move or edit a review themselves.
- **The appraisal PDF draws text in script runs.** The vendored Mukta files are split
  by script, and the Devanagari one has only the space and the danda besides its
  letters, so punctuation and digits are drawn with the Latin file. Dates are the
  Kathmandu day, in AD and BS.
- **A demo duty log** (`npm run seed:trips`, also run by the fleet demo) lays trips
  between the demo fuel fills, ending at least two days ago, so the demo scorecards have
  something to show and nothing collides with a test run.

## Step 7: income and ticket records (Feature 6)

- **Off until an owner turns it on, and turning it on needs an authenticator.** The
  owner sets one up from the portal if they have none (QR drawn by the API, a tap-to-open
  link for the same phone, or the key typed in), then confirms with a fresh code. From
  then on that owner's sign-in asks for the code: `completeSignIn` treats an OWNER of a
  company with income records on like a privileged role. Turning it off keeps the data.
- **Managers enter income; totals are the owner's to share.** A manager uses the daily
  sheet and imports, which show the rows being entered and their running sum. The
  dashboard, reports, reconciliation and exports are refused (403, `TOTALS_HIDDEN`)
  unless the owner ticks "Managers can see totals". Crew accounts never touch income.
- **Integer paisa everywhere; fuel, maintenance and repair costs stay whole rupees** in
  their own modules and are multiplied by 100 at the report layer.
- **A settlement reference is unique per source among live entries**: a partial unique
  index (`income_entry_source_reference`, raw SQL), so an undone import can be imported
  again. The import inserts with `ON CONFLICT DO NOTHING`, so a reference saved by
  someone else a moment earlier is skipped, not an error. Importing the same file twice
  adds nothing.
- **Deletes are soft and entries lock 7 days after they are made** (`lockedAt`), not 7
  days after the day they describe, so last month's takings can still be entered.
  Every create, edit, delete, import, undo, photo and setting change is audited.
- **Imports: CSV by an in-house reader, XLSX by fflate.** The npm `xlsx` package has
  unfixed high advisories. Date cells are read from the workbook's own number formats.
  Columns are mapped by header name, guessed by a generic adapter and saved per source;
  `IncomeImportAdapter` is the hook for a portal integration if Bussewa, eSewa or Khalti
  ever publish an API. Dates can be BS. Undo within 24 hours.
- **Operating profit = net income − fuel − maintenance − breakdown repairs** recorded for
  the same days, with a note saying it leaves out wages, loan instalments, permits, tax
  and insurance. Occupancy is tickets ÷ (seats × trips logged); without the duty log it is
  left out rather than guessed. By driver, income follows the trip it was entered against;
  costs belong to buses, so there is no profit by driver. Weeks start on Sunday.
- **Statement photos live in private storage**: `StorageService`, disk in development
  (never served statically) or any S3-compatible bucket (R2) in production, reached only
  through links that expire in five minutes. The S3 driver signs its own requests (SigV4,
  checked against AWS's published examples) rather than pulling in the AWS SDK.
  Production needs `SIGNED_URL_SECRET`. Photos are checked by their bytes; re-encoding
  with sharp comes with step 10.
- **CORS now allows PUT**, for saving a whole day's sheet in one request. The smoke suites
  call the API without a browser, so a method missing from CORS only shows in the
  browser; the daily sheet was checked there.
- **Demo income** (`npm run seed:income`, also run by the fleet demo) lays cash, Bussewa,
  eSewa (some without references) and parcels on the demo trips, with finance left off.
