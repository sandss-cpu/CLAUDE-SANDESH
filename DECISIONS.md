# Decisions

Choices made while building Batoma Phase 3 that someone reading the code later would
otherwise have to guess at. Newest last within each section. Things only the product
owner can decide (domains, legal wording, prices) are not here; they are asked.

## Working arrangement

- **Phase 3 was built on the `phase3` branch** of the GitHub repository, in
  `~/Desktop/COASTER.2019/travel-platform 3`. `main` and the other local copies stayed
  untouched until the owner decided to merge.
- **Merged into `main` on 6 October 2026**, at the owner's request, as a fast-forward (no
  merge commit, nothing rewritten).
- **The local copies moved to Phase 3 the same day, on `batoma_phase3`.** Every copy's
  `backend/.env` points at it and carries its encryption keys. `travel_magazine` is kept
  untouched as the pre-Phase 3 database (a dump and the old `.env` are in
  `~/batoma-backups`), and `Start_Bato.command` writes a fresh `.env` for `batoma_phase3`,
  so no copy applies the Phase 3 migrations to it. The launcher also reinstalls packages
  whenever `package-lock.json` or the Prisma schema changes, since updates now arrive from
  Dependabot.
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

## Step 8: the reading experience (Feature 4)

- **Every article has a one-line summary and up to three key points.** The migration
  backfilled summaries in SQL from each article's first sentence (headings and emphasis
  removed); `firstSentence()` does the same for elevated traveller posts and the seed.
  Publishing needs both, but only when an article becomes published: stories published
  before the rule keep their status. The admin form counts characters to 160.
- **Cards show title, one-line summary, read time and audio**; the standfirst stays on the
  story page only.
- **Long stories fold.** Over 600 words, the body stops after the paragraph that passes
  about 280 words, with "Continue reading · N min more"; the end-of-story options follow
  the fold, so they come sooner. A contents list appears with three or more subheadings
  (`##`, `###`); jumping to a folded section unfolds the story first. Markdown stays the
  small safe subset: text is escaped before headings, bold and italics are added.
- **Progress, "Next" and "Up next".** A 4 px progress bar along the top; at 70% read a
  48 px "Next: <title>" bar above the bottom navigation, dismissible per story; at the end
  a large "Up next" (the next story in this bus's programme) and two related stories, the
  same section first.
- **"Continue where you left off"** comes from the scroll position saved on the phone per
  story (the 20 most recent, kept a week). A story counts as left part-read only once the
  reader has scrolled into it (15% or more) and before 95%.
- **"Keep reading" is labelled**: arrows on wide screens with a mouse, the next card
  peeking in on phones, and "See all".
- **Stops on this road are a timeline in travel order** (`common/utils/stops.ts`, shared
  with the reader as `web/js/lib/stops.js`): the road guide's stops for the direction the
  bus is going, joined with the businesses listed on the corridor (a listed business that
  is also a guide stop appears once, under its own name, labelled "Promoted"). Where the
  bus is comes from the crew's trip departure (now in the scan answer) or the scan time;
  passed stops are counted, not shown. Groups: coming up (three), later, at the
  destination (by distance, or by the business's district), and along this road. Four are
  shown; "See all" opens the Road tab. Open or closed is read from the guide's opening
  hours as written ("6am–9pm", "06:00-21:00", "6pm–2am", "24 hours"); anything else says
  nothing rather than guess.
- **Offline.** On a first scan the service worker does not control the page yet, so the
  road guide is handed to it explicitly. The offline pack is downloaded again if the
  phone has cleared its cache, even when the note saying it was saved survived.
- **Accessibility.** Lighthouse accessibility and best practices: 100 on the reader. Text
  contrast was checked in all three themes; section tags, the night theme's brand text,
  the rating stars and the bright-sun button were darkened to reach AA. Chips, tabs and
  the report button were raised to 48 px.

## Step 9: the public website (Feature 3)

- **A separate small server, `site/`** (deployed as `bato-site`): Express 5 and
  TypeScript, pages drawn on the server from tagged templates that escape everything
  unless it is markup made in the site's own code (`html`, `raw`). No framework and **no
  script on any page**: the menu is a `<details>`, filters are GET forms, enquiries are
  POST forms. Its CSP is `script-src 'none'` and `style-src 'self'`; a test fails on any
  inline handler, inline style or script other than JSON-LD.
- **It reads through its own database role, `batoma_site`**, never the owner. Column
  grants keep owners, verification notes and private fields out; row-level security
  policies show only published articles, issues and guides, verified and active
  businesses, their photos and live coupons, and website ad slots. The API connects as
  the tables' owner, which the policies do not bind. The role's only write is INSERT into
  `site_events`, without RETURNING (the role cannot read the row back).
  `npm run db:site-role` (re)applies it after migrations, with the password from
  `SITE_DB_PASSWORD`; `prisma/site-role.sql` is the reference.
- **Forms go through the site's server to the API**, with `x-site-key` (SITE_API_KEY,
  compared in constant time) and the visitor's address in `x-site-client-ip`. The API
  routes refuse anything without the key, so the API never takes public form posts from
  the internet. The site adds a hidden honeypot field and a signed time token stamped
  into each page as it is served (not when it is cached): under three seconds is a bot,
  over a day is stale. A bot is told it worked; nothing is sent. Ten posts per address
  per ten minutes, in memory. Post, redirect, get; an error shows the form again with
  what was typed.
- **The newsletter is double opt-in.** Only a hash of the confirmation token is stored;
  the email link opens a page with a button, and only the POST confirms, because mail
  scanners follow links. Subscribing and unsubscribing answer the same whether or not the
  address is known. The export is the confirmed list with each reader's unsubscribe
  link, and it is audited.
- **Counting without cookies.** A visit is a salted SHA-256 of address, browser and the
  half-hour, cut to 32 characters: it changes every half-hour and cannot be turned back
  into an address, so no cookie notice is needed. Page views and impressions are
  recorded on every serve, from the page cache too, because partners are sold on them;
  bots and page testers are not counted. A click (`/go/…`) is one row per target per
  visit: a partial unique index on `(target, "sessionHash") WHERE type = 'CLICK'` drops the
  repeat in the database.
- **`/go/<partner>` and `/go/ad/<id>`** record the click and redirect (302, `no-store`,
  `noindex`) to the partner's website with `utm_source=batoma&utm_medium=referral`, to
  WhatsApp, or to the map. Phone and Viber links stay direct: a redirect to `tel:` or
  `viber:` is unreliable across phones. Every `/go/` link carries `rel="sponsored
  noopener"`, and robots.txt keeps crawlers off `/go/`.
- **Everything paid for is labelled** "Sponsored · <name>", in its own slot only, between
  its dates. Featured and premium partners show "Featured partner" and come first in
  lists. A sponsored story names its partner at the top and the end.
- **Pages are kept in memory for five minutes** (`PAGE_TTL`) and dropped at once when the
  API calls `/_purge`, signed with HMAC-SHA256 of the time under SITE_API_KEY and valid
  for five minutes; routes that change what the site shows carry `@PurgeSite()`.
  Browsers get `private, max-age=60, stale-while-revalidate=300`: **private on purpose**,
  so no shared cache in front can hide views from the counts in the partner report. A
  CDN, if one is added, must pass HTML through.
- **The monthly partner report** counts, by Kathmandu day: website impressions and clicks
  (`site_events`), app profile views and contact taps, enquiries from both, and coupons
  claimed and redeemed. CSV (with a byte-order mark for Excel) and PDF, for the owner and
  for admins; anyone else's listing is 404.
- **Leads now hold who wrote and how to reply** (name, contact, message, channel). The
  contact is personal data kept for that partner only; it is encrypted at rest in step 10
  with the other contact fields.
- **Partner packages are records of what was sold**, not the ads themselves: kind, dates,
  price in paisa, status, notes, audited on every change. The ad for a slot is still set
  up under Ads, with a section or place target for the two sponsor slots.
- **The partner area is `web/business.html`** with `web/js/business.js`: overview,
  enquiries, deals (publish, end early, redeem a code), reviews and replies, the monthly
  report and the listing itself. It signs in through `login.html` and shares the
  reader's session (`bato.auth`) and refresh lock. Ending a deal is a new route,
  `PATCH /businesses/coupons/:id/end` (someone else's deal is 404).
- **Verification and tier changes are now audited** (`business.verify`,
  `business.tier`), and the tier route validates its input (a known tier, 1 to 24
  months). Note that setting the same tier again is a renewal: it extends the
  subscription by the months given.
- **Legal pages are drafts**, marked "needs legal review" and kept out of search until a
  lawyer has read them. The privacy draft describes what the code does today, including
  the SOS location and anonymous bus reviews.
- **Fonts, icons, the schema and the BS calendar are copied in at build time**
  (`site/scripts/prepare.mjs`) from `web/` and `backend/`, so there is one source for each.
- **Measured** with Lighthouse, mobile, on every page type (16 pages): performance 99,
  except a place page with a Nepali name at 92–94, which fetches the 107 KB Devanagari
  Mukta file for that one word. Accessibility and best practices are 100 everywhere.
  SEO is 100 except Privacy and Terms, which score 66 because they are deliberately
  `noindex` while they are drafts.

## Step 10: security hardening (Feature 7)

- **Field encryption through Prisma middleware** (`common/crypto/field-crypto.ts`), not
  an extension: `$use` keeps `PrismaService` a plain `PrismaClient`, so no service's types
  change. Writes to the listed fields are encrypted, nested writes included (relations
  are read from Prisma's own schema description); every result, raw queries included, is
  walked and any `enc:` value decrypted. AES-256-GCM, a fresh 96-bit IV per value, the key
  id in the stored form so keys rotate without downtime. Existing rows are encrypted by
  `npm run fields:encrypt`, not SQL, because keys must never be in a migration.
- **Encrypted**: drivers' phone and licence numbers, companies' contact phones (with a
  keyed hash for exact-match search; "contains" search on phones is gone), emergency
  contacts, income notes, lead and enquiry contacts, and authenticator secrets (the brief
  did not list these; they are as sensitive as passwords). Not encrypted: business phones
  (public), user phone and email (unique sign-in lookups), the newsletter list.
- **Lockout in the database** (`login_guards`), so it holds across API instances. Per
  account: four free mistakes, then waits of 30 s, 1, 2, 5 and 15 minutes; while locked the
  password is not even checked. Per address hash: 30 failures in an hour locks it for 15
  minutes. An unknown email gets a key of its own, so locking behaves the same whether or
  not the account exists. Locks are short on purpose: anyone can type someone's email.
- **"Sign out everywhere" ends access tokens too**, through `users.sessionsValidFrom`,
  which `JwtStrategy` compares with each token's issue time (it already loads the user on
  every request). Password resets, role changes, suspensions and authenticator resets set
  it as well.
- **An authenticator, once set up, is always asked for**, whatever the role. Before, a bus
  owner who turned income records off again signed in without it.
- **Recovery codes**: ten, 50 bits each, shown once, stored as SHA-256 (random enough
  that a slow hash adds nothing), each used once; a fresh set needs a current code.
- **New-device email** when an account signs in from a browser family it has not used
  ("Chrome on Android"): versions are ignored, or every browser update would alert.
- **Passwords**: 10 characters minimum, the SecLists 10,000 most common, the same with
  digits or symbols added, and the person's own name and email are refused. No
  composition rules.
- **Every picture is drawn again** with sharp (0.35.5, clear of the libvips advisories in
  0.34) as WebP without metadata, at 480, 960 and up to 1600 pixels; files are named
  `<id>-<width>.webp`, so the website works out its `srcset` from the address.
- **Verification documents** in private storage: photos re-encoded, PDFs kept but refused
  when they carry scripts, launch actions or attachments, and always downloaded rather
  than opened on our origin. Owners only (not managers), plus admins and moderators, whose
  every look is audited.
- **Row-level security for fleet and finance: evaluated, not adopted.** The API connects as
  the tables' owner; for policies to bind it the tables would need `FORCE ROW LEVEL
  SECURITY` and every query a per-request `SET LOCAL app.operator_id` inside a transaction.
  With Prisma's pooled connections that means wrapping each query in its own transaction (a
  second round trip on the busiest owner screens), and seeds, retention, admin statistics
  and the website's role all need a bypass. The policy that keeps those working ("unset
  means allowed") protects exactly the code that forgets to set it, which is the case RLS
  would be for. Instead: one access layer (`FleetAccessService`, `FinanceAccessService`) and
  an IDOR suite generated from the live route table, which fails on any route it cannot
  fill in. RLS stays where it fits: the website's separate, read-only role.
- **The IDOR suite is generated, not listed.** It reads every route from the running app
  and calls each fleet, finance, trip, appraisal, document and partner route as another
  company's owner, as crew, as a manager (owner-only routes) and as a traveller (partner
  routes), with a valid body for every write so input validation cannot answer first. Every
  call must answer 403 or 404: 193 calls on the first run.
- **No inline code anywhere**: `login.html`, `creator.html` and `preview.html` moved to
  `web/js`; the last inline handler in the control panel (articles' Edit) went too. The
  test now scans every page and every script. The web app's CSP is `script-src 'self'`;
  `style-src` keeps `'unsafe-inline'` for style attributes, which cannot run code. One
  header definition (`scripts/web-headers.mjs`) feeds the local server, and a test keeps
  `render.yaml` in step with it.
- **Logs**: Nest's logger is replaced by `JsonLogger`, which redacts every message
  (emails become `a***@domain`, phone numbers keep their first and last two digits, tokens
  and signed-link parameters go) and writes one JSON object per line in production. The
  disabled-SMS log no longer prints the sign-in code. Error responses and logs carry the
  path without the query string.
- **Retention at the start of a Kathmandu day**, 13 calendar months back, so each day is
  rolled up once and whole. Partner reports read the raw events and the daily counts
  together, so old months still add up.
- **Sentry is optional** (`SENTRY_DSN`): no default PII, no request data beyond method and
  path, user reduced to an id, messages redacted.
- **`strictNullChecks` through a second config** (`tsconfig.strict.json`) over the Phase 3
  modules; the old code they import was fixed rather than excluded (a QR code whose bus was
  gone, recipients without an email, dates the DTO requires but the type allowed to be
  null).
- **CI checks the scan, not just the build**: the ZAP baseline runs against the running
  web app, website and API in the same job, and `scripts/zap-summary.mjs` fails the run on
  any high-risk finding and posts the counts as annotations (readable on the public
  repository without signing in).
- **ZAP baseline, first run (CI, 5 October 2026): no high-risk findings.** Medium findings
  accepted, with reasons: `style-src 'unsafe-inline'` (style attributes; styles cannot run
  code); "wildcard" `https:` in `img-src`/`connect-src` (the API and image addresses are set
  per deploy; step 11's `/api` proxy lets `connect-src` become `'self'`); "absence of
  anti-CSRF tokens" on the website's forms (they carry a signed time token, and there is no
  cookie or session for a forged request to ride on: the API takes them only from the
  site's own server).

## Step 11: ready to host

- **Three domains, one origin for the app.** `<PUBLIC_DOMAIN>` is the website (bato-site);
  `app.<PUBLIC_DOMAIN>` is the static app (bato-web), which rewrites `/api/*` to the API, so
  the app and its API share one origin: no CORS preflight on a weak signal, and the web
  app's CSP can say `connect-src 'self'`. `API_PUBLIC_URL` is the app's origin, so offline
  packs are cached under the address the reader asks for (the step 2 gap).
- **Stickers carry `https://<PUBLIC_DOMAIN>/b/<code>`**, which the website answers with a
  302 to `https://app.<PUBLIC_DOMAIN>/b/<code>`. 302, not 301: browsers keep a 301 for good,
  and the app's address may change one day; the sticker's never can. One extra hop on the
  first scan (the plan's risk 2); the service worker answers later scans.
- **Files in buckets only, in production.** `STORAGE_DRIVER=s3` is required: a server disk
  is lost on redeploy and cannot be shared by two instances. Two buckets: private
  (statement photos, verification documents, signed links) and public (pictures, served
  from `MEDIA_BASE_URL`, e.g. an R2 custom domain, cached for a year because names never
  change). Local development keeps the disk.
- **Render generates the secrets** (`generateValue`): JWT, field encryption, blind index,
  signed links, the website's key and its database password. A bare generated key counts
  as encryption key `v1`, so the generated value works as it is; GO_LIVE.md says to copy the
  encryption keys out the day they are made.
- **The website builds its database URL from parts** (`SITE_DB_HOST`, `_PORT`, `_NAME` from
  the database, the password from the API service), because Render cannot put a URL
  together from another service's values.
- **The deploy runs `migrate deploy`, `db:site-role` and `fields:encrypt`**, all safe to
  repeat, so a new column the website needs or a new encrypted field is handled by the
  next deploy rather than by memory.
- **Scheduled work stays inside the API** (`@nestjs/schedule`): reminders at 06:00 and
  retention at 03:30 Kathmandu time. Retention takes a Postgres advisory lock, so two API
  instances cannot roll the same rows up twice; reminders were already de-duplicated by key.
  The weekly backup is the one Render cron job: it needs `pg_dump` and `age`, which the API's
  image does not have.
- **Backups**: the database plan's point-in-time recovery, plus a weekly `pg_dump`
  encrypted to an `age` public key whose private half never touches a server, kept 13 weeks
  in a separate bucket.
- **`TRUST_PROXY=2` on the API**, because requests pass bato-web's rewrite and Render's own
  proxy. This is the one setting only production can confirm; GO_LIVE.md step 6 checks it
  from two networks.
- **`prod_smoke.sh` signs in only to a company whose name starts with TEST**, so a smoke
  run can never be pointed at a real company's data by mistake.

## After Phase 3: adding routes from the control panel

- **Routes are added and edited in Route programming** (and Route guides), by editors and
  admins, the people who programme them; moderators only read. Every add and edit is in the
  audit log and the route's Changes tab. The old `POST /operators/routes` (admins only, no
  audit, no edit, a duplicate code answered with a server error) is removed.
- **No delete.** Buses, trips, reviews, stickers, guides and ads point at routes, so a
  mistaken route is renamed or corrected instead. Removing one stays a database task.
- **Code and name must be unique** (the name ignoring capitals), and the two places must
  differ: two routes called the same thing in one list would be picked by mistake. The same
  two places may have more than one route, for different roads.
- **Empty optional fields clear on an edit.** The form sends every field, so a number left
  empty is read as cleared from the value as sent: the API's implicit conversion would
  otherwise have turned "" into 0.

## After Phase 3: Stories, Events, Write a trip, Advertise (October 2026)

- **"Magazine" became "Stories"** in the website's menu and pages, at `/stories`. The section
  holds written stories and road guides, not videos (vlogs live in the app), and "Stories"
  matched the site's own "Latest stories". `/magazine…` answers with a permanent redirect, so
  shared links and search results keep working.
- **Events are content**, so editors and admins manage them, as they do articles and guides.
  A cancelled event stays listed and marked, because someone may have planned to go; a draft
  never reaches the website (row-level security). Events list until their last day is over in
  Kathmandu. No JavaScript: filters are a GET form and "Add to your calendar" is an `.ics` link.
- **Write a trip is one website form, confirmed by email.** The website has no sign-in and no
  cookies, so it never handles passwords: sending a story makes (or finds) the account by email,
  and the story reaches editors only once the emailed link is followed. That proves the address
  (nobody can send under someone else's email) and keeps spam out of the editors' queue. A new
  writer then gets the existing password email, worded to set a first password. The response is
  the same whether or not the address has an account. Unconfirmed stories are deleted two weeks
  after their link expires (retention job).
- **Featuring makes a draft, not a published article.** Publishing needs a summary and key
  points, and editors want to edit and add pictures; the writer keeps the byline. Photos are not
  uploaded through the website form (no script, and a public upload is an abuse risk): editors
  ask featured writers for them.
- **Advertise shows the vision and mission instead of live audience figures.** The public
  `/site/audience` endpoint went with them; partners still see their own figures in their
  monthly report. The wording is Batoma's own and can be changed in `site/src/pages/info.ts`.

