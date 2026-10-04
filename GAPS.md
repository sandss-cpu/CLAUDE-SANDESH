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

## Remaining gaps

### Covered by later Phase 3 steps

| Gap | Step | Effort |
|---|---|---|
| One QR per bus, magazine first; `bus.html?code=` redirect; stickers as PDF/PNG/SVG; seat-sticker minting UI (`/qr/batch`, `/qr/stats` have no UI) | 5 | L |
| Driver scorecards and appraisals (review attribution to trip and crew is done) | 6 | L |
| Income records | 7 | L |
| Reading UI: summaries, "In brief", "Keep reading", the stops timeline | 8 | L |
| **No business owner area in the web app.** `/businesses/mine`, `/:id/dashboard`, coupon creation and redemption, and review replies have no page. | 9 (`business.html`) | M |
| **No admin screen for verifying businesses.** `/businesses/admin/pending-verification`, `/:id/verify`, `/:id/tier` and `/:id/routes` have no UI, though verification is meant to be manual. | 9 (partners admin) | M |
| "Sign out everywhere" (`/auth/logout-all` has no UI) | 10 | S |
| Moderation audit trail (`/moderation/audit` has no UI) | 10 (security events view) | S |
| Traveller account: data export and deletion (`DELETE /users/me` has no UI) | 10 | M |
| Inline scripts and handlers in `bus.html`, `login.html` and `creator.html` (CLAUDE.md known gap 7; the reader, control panel and owner portal are done) | 5–10 | M |
| Google Fonts on every app page (a third party on each visit, and a CSP exception) | 9–10 (self-hosted) | S |
| Development logs print recipients' email addresses (`[MAIL DISABLED] to …`) | 10 (log redaction) | S |
| Sign-in, owner portal, admin and emails still say "Bato" | 3–11, as each is touched | S |
| `API_PUBLIC_URL` must equal the origin the reader calls once `/api` is proxied through the app domain. Offline packs are cached under the address the API reports, and the reader looks stories up under its own. | 11 | S |
| `strictNullChecks`; company verification documents (CLAUDE.md known gaps 6 and 4; BS dates are done) | 10 | M |

### Not in the Phase 3 brief (owner's call)

| Gap | Effort | Note |
|---|---|---|
| **Offline map tiles.** No tile pipeline or map renderer exists, and `MapPack` rows point at example URLs. | XL | Hidden rather than faked. Needs a tile source, a hosting budget and a renderer, or the native app. |
| Comments, reactions and bookmarks (`/engagement/*`, 7 routes) have no UI | M | Comments need moderation UI as well. |
| Itinerary builder (`/itineraries/*`, 12 routes): templates, permits, budget, suggest, share, fork | L | The Trips tab uses editor-written guides instead. |
| Places (`/places/*`, 7 routes): nearby, bounds, altitude check, destination pages | M | Partly superseded by guides; the public site may use destination pages. |
| Traveller profile and privacy settings (`/users/me`, privacy, follow, feed) have no UI | M | `hideExactLocation` and `publishDelayHours` can only be changed through the API. |
| The legacy `operators` module (`/operators`, `/operators/vehicles`, `/operators/lost-items`, `/operators/:id/dashboard`) is superseded by `fleet` | S | Retire it, or move lost-item reports into the bus page. |
| Article translations (CLAUDE.md known gap 1) | L | Needs a relation between language versions. |
| Payments (eSewa, Khalti) for listings and ads (known gap 2) | XL | Tiers and ads are still set by hand. |
| `normalisePlate` drops Devanagari vowel signs (known gap 8) | M | Re-keying existing rows and the migration backfill together. |
