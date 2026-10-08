# Gaps

Find-and-finish audit for Batoma Phase 3, made on 4 October 2026 against the `phase3`
branch. Re-run the mechanical parts with:

```bash
node scripts/api-coverage.mjs        # routes no page calls, and calls no route answers
grep -rnE "TODO|FIXME" backend/src web scripts
```

Effort: **S** up to half a day, **M** one to two days, **L** three to five days, **XL** more
than a week.

## What the audit found

- **No TODO or FIXME comments** anywhere in the backend, web or scripts.
- **No UI calls a missing route** (0 of 122 distinct paths).
- **No dead links** between pages or to local assets.
- **57 of 222 routes have no UI.** They are grouped below.
- **Demo content was reachable in production in eight places.** All were in the
  reader, and all are fixed below.

## Launch blockers fixed in step 2

| # | Was | Now |
|---|---|---|
| 1 | The reader always resolved `DEMO2024`, so every bus showed the same corridor. | Reads the code from `/b/<code>`, `/r/<code>`, `?c=` or `?code=`. Remembers the scan for 12 hours (for example, after signing in). Keeps each code's last answer for scans with no signal. |
| 2 | `resolve()` used the route printed into the sticker. | Uses the bus's current route; only a seat sticker with no bus falls back to its own. |
| 3 | "Stops on this corridor" listed 12 unfiltered businesses. | Shows that route's corridor businesses, saved with the scan, including phone and WhatsApp for offline use. Nothing is shown when the route has none. |
| 4 | **Live articles never showed their text.** The list carried no body, and opening one said "This story is available in the full issue". | `openArticle` fetches the story. The service worker answers from its cache with no signal; a story not saved yet says so. |
| 5 | **The first scan saved nothing for offline,** because the pack was posted only to a controlling service worker, and there is none on a first visit. | The pack is posted to the active registration. The chip reads "Saving…" until the worker confirms. |
| 6 | "Save offline" showed a toast and saved nothing. | Keeps a reading list on the phone and asks the worker to cache the story. It only says "offline" when the worker confirms. |
| 7 | "Listen" animated a progress bar with no sound, even for articles with audio. | A real `<audio>` player. The bar is shown only when an article has narration. |
| 8 | "Offline maps" pretended to download packs (the seeded `cdn.example.np` URLs). | Removed. The tab is now **Road**: the editors' road guide for this route, in the direction of travel. |
| 9 | The Map tab listed Kathmandu–Pokhara stops on every bus. | Shows the guide for the bus's own route, and only in the bundled demo uses the sample road. |
| 10 | "Make this my trip" always produced the bundled three-day Pokhara plan. | "Plan this trip" opens Trips filtered to the article's place, or to the end of this road. |
| 11 | Business Call, WhatsApp and Directions buttons only showed a toast. | Real `tel:`, `wa.me` and maps links. Each button appears only when there is a number or location, and the lead is still recorded. |
| 12 | Real listings showed a sample "10% off for Bato readers" coupon. | Demo only. |
| 13 | An install banner advertised App Store and Play Store apps that do not exist. | Shown only when a store URL is configured. `.env.example` no longer ships placeholder store links. |
| 14 | `GET /businesses/:slug` returned the whole row: the owner's account id, the admin who verified it, the admin's private verification note, and the subscription end. It also served switched-off listings. | Lists public fields explicitly; switched-off listings return 404. |
| 15 | Seat stickers encode `/r/<code>`, which the hosted static site would 404. | `render.yaml` rewrites `/b/*` and `/r/*` to the reader. So does the new local dev server. |
| 16 | A guide read in REVERSE kept forward distances: the first stop towards Kathmandu read "200 km". | Distance and time are counted from the end the traveller set off from. |
| 17 | An archived bus's stickers still opened through `resolve()`, despite CLAUDE.md saying they stop. | They return "no longer active". |
| 18 | Scanning an unverified company's bus showed the company's name. | Hidden until Batoma verifies the company, as everywhere else. |
| 19 | The installed app was called "Bato". | "Batoma". |

## Done in step 3

- Route programming: direction, schedules, company and bus overrides, notices, history and
  the traveller preview (Feature 1).
- The masthead reads "Batoma · Kathmandu → Pokhara", with the direction chip.
- **Articles could not be put on a route from the control panel at all.** The article form
  had no corridor field, so only the seed ever linked one. Route programming is that tool.

## Done in step 4

- The duty log: trips, crew accounts and the conductor's duty screen; reviews put against
  the crew on duty; owners see the crew on each review and can filter by crew member.
- Bikram Sambat dates beside AD on the Trips and Duty screens.
- The owner portal's inline handlers moved to data attributes, and it calls itself Batoma.
- Scripts are now served `no-cache` on Render too, not only pages.

## Done in step 5

- One QR per bus, magazine first and rating second; stickers as PDF (A6, seat back, A4
  fleet sheet), PNG and SVG, with print history, in the owner portal and the control panel.
- `bus.html?code=` sends bus codes to the magazine; `bus.html` lost its inline script.
- `scan.html` scans a bus's QR from inside the app.
- Fonts are self-hosted on every page (no Google Fonts, and the CSP no longer allows it).
- A unit test keeps the pages honest: no third-party scripts or stylesheets, no inline
  code on the converted pages, and every pre-cached file exists.

## Done in step 6

- Driver scorecards for any period, the owners' leaderboard, appraisals with a printable
  English and Nepali PDF, and crew disputes settled by moderators.
- A moderator signed in on a reload no longer lands on Articles, which they cannot load.

## Done in step 7

- Income and ticket records: daily sheet, CSV/XLSX import with undo, reports with
  operating profit, dashboard, reconciliation, CSV and PDF export, statement photos in
  private storage, and the finance switch behind an authenticator.
- The owner portal can set up an authenticator, at sign-in or while signed in; it used to
  send people to the control panel to do it.

## Done in step 8

- Reading experience: summaries and key points, folding, contents, progress, "Next",
  "Up next", "Continue where you left off", the labelled rail and the stops timeline.
- Fixed on the way: the reader's bottom-navigation styles applied to every `<nav>`; the
  offline pack was never downloaded again after a phone cleared its cache; italics in
  stories were shown as asterisks; no page had a favicon (a console 404 on every load).

## Done in step 9

- The public website (`site/`): magazine, trips and places, partners and deals, write a
  trip, advertise, about, contact, newsletter, and draft privacy and terms pages, read
  through a read-only database role.
- The business owner area (`web/business.html`): enquiries, deals, reviews and replies,
  the monthly report, and the listing.
- Control panel "Website" screen: verifying listings and setting tiers (now audited),
  partner packages, the enquiry inbox and the newsletter export.
- Found on the way: re-saving a listing's tier counts as a renewal and extends the
  subscription by a month; the panel's tier dialog says so.

## Done in step 10

- Recovery codes, lockout, new-device alerts, "sign out everywhere" (with a UI on every
  surface), 10-character passwords checked against common ones, account export and deletion.
- Field encryption with key rotation; verification document upload; uploads re-encoded;
  redacted JSON logs; 13-month retention; Sentry; the Security events view.
- No inline script on any page (known gap 7 closed); strict CSP, HSTS and per-page
  Permissions-Policy; rate limits on scans, reviews, leads and `/go`.
- The generated IDOR suite, `strictNullChecks` for the Phase 3 modules, GitHub Actions with
  a ZAP baseline scan, Dependabot. THREAT_MODEL.md and SECURITY.md.
- Found on the way: the control panel's articles list still had an inline handler; a bus
  owner with an authenticator stopped being asked for it once income records were off;
  the disabled-SMS log printed sign-in codes; statement photos kept their GPS metadata.

## Done in step 11

- `render.yaml` with the API, the app (with the `/api` rewrite), the website (with the
  sticker short link), Postgres with point-in-time recovery, R2 buckets and a weekly
  encrypted backup; production refuses to start without its storage, sticker and website
  settings; `seed:prod` checks the admin's password; `scripts/prod_smoke.sh`; GO_LIVE.md.
- The audit, again: no TODO or FIXME comments; no calls to missing routes (the coverage
  script now reads files with several controllers and inherited routes); the only demo
  path is the labelled sample magazine with no code and no API, as decided in step 2;
  public uploads now go to a bucket in production instead of the API's disk.
- Found on the way: no screen made fresh recovery codes, and owners could set up an
  authenticator only by turning on income records; both are in the owner portal and the
  control panel now.

## Remaining gaps

### Covered by later Phase 3 steps

| Gap | Step | Effort |
|---|---|---|
| `strictNullChecks` for the older modules (on for Phase 3 code through `tsconfig.strict.json`) | after launch | L |
| Things only the owner can do: the domain, Render, R2, email and Sentry accounts, the first restore drill, legal review of Privacy and Terms, package prices (GO_LIVE.md) | before launch | S |
| `TRUST_PROXY` must be confirmed on the live service (GO_LIVE.md step 6) | at launch | S |
| Corridor targeting for a partner (`/businesses/:id/routes`) has no screen | after launch | S |
| Writers cannot upload photos with a story from the website, or see their stories' status in the app; editors ask featured writers for photos, and status comes by email | — | M |
| Events are on the website only, not in the bus reader app | — | M |
| Creators edit only in the app; the website shows their pages but has no sign-in of its own (by design: no script or cookies) | — | — |
| Routes cannot be deleted from the control panel (on purpose: buses, trips and stickers point at them); a wrong one is corrected or renamed | — | S |
| A listing cannot be taken down or deleted from the control panel; it can be edited and its owner unlinked (enquiries, reviews and deals point at it) | — | S |
| A business cannot add its own listing; Batoma adds it and links the owner's account | — | M |

### Not in the Phase 3 brief (owner's call)

| Gap | Effort | Note |
|---|---|---|
| **Offline map tiles.** No tile pipeline or map renderer exists, and `MapPack` rows point at example URLs. | XL | Hidden rather than faked. Needs a tile source, a hosting budget and a renderer, or the native app. |
| Comments, reactions and bookmarks (`/engagement/*`, 7 routes) have no UI | M | Comments need moderation UI as well. |
| Itinerary builder (`/itineraries/*`, 12 routes): templates, permits, budget, suggest, share, fork | L | The Trips tab uses editor-written guides instead. |
| Places (`/places/*`, 7 routes): nearby, bounds, altitude check | M | Destination pages now exist on the website (`/places/<slug>`). |
| **The app's business list and profile include unverified listings** (`GET /businesses`, `GET /businesses/:slug` filter on `isActive` only). The website shows verified listings only. | S | Decide whether the app should match the website. |
| Images on the website have no `srcset` | S | Sizes are generated at upload in step 10 (sharp); the site picks them up then. |
| Traveller profile and privacy settings (`/users/me`, privacy, follow, feed) have no UI | M | `hideExactLocation` and `publishDelayHours` can only be changed through the API. |
| The legacy `operators` module (`/operators`, `/operators/vehicles`, `/operators/lost-items`, `/operators/:id/dashboard`) is superseded by `fleet` | S | Retire it, or move lost-item reports into the bus page. |
| Article translations (CLAUDE.md known gap 1) | L | Needs a relation between language versions. |
| Seat-sticker minting and statistics (`/qr/batch`, `/qr/stats`) have no UI | S | One code per bus replaces seat stickers; seat codes still resolve, so existing ones keep working. |
| Payments (eSewa, Khalti) for listings and ads (known gap 2) | XL | Tiers and ads are still set by hand. |
| `normalisePlate` drops Devanagari vowel signs (known gap 8) | M | Re-keying existing rows and the migration backfill together. |
