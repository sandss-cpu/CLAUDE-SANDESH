# Batoma Phase 3: completion report

6 October 2026. All 11 steps of `BATOMA_PHASE3_PROMPT.md` are built, tested and merged into
**`main`** on GitHub (6 October 2026). Nothing is on the internet yet: going live needs your
accounts, your domain and a lawyer's review (section 5).

This report holds no passwords or keys. Test logins are kept outside the repository.

---

## 1. Where everything is

| What | Where |
|---|---|
| Phase 3 code | this repository, branch **`main`** (built on `phase3`, merged on 6 October 2026) |
| Local database | `batoma_phase3` on Postgres (port 5432); `batoma_test` is a throwaway copy for the automatic tests |
| Going-live checklist | `GO_LIVE.md` in the code folder |
| How Batoma is protected | `SECURITY.md` and `THREAT_MODEL.md` |
| Why things were built the way they were | `DECISIONS.md` |
| What is still missing | `GAPS.md` |

**Important:** `backend/.env` holds the keys that encrypt phone numbers,
licence numbers and authenticator secrets. If that file is lost, those values cannot be
read again. Keep a copy in your password manager. It is never put on GitHub.

---

## 2. What was built, step by step

| Step | What it means for people using Batoma | Commit |
|---|---|---|
| 1. Plan and set-up | The folder linked to GitHub on its own branch and its own database, so nothing else was disturbed. | `ccc7330` |
| 2. Audit and fixes | Upgraded the framework (NestJS 11) to clear its security warnings. Fixed the launch blockers: every bus used to show the same demo route, stops were not filtered by route, and live stories never showed their text. | `6902241`, `5f86a5a`, `d83af9f` |
| 3. Route programming | The control panel decides which stories each bus shows, by route, direction, company or single bus, with schedules (for example, mornings only), pinning, a preview and a change history. Route notices (road closures, warnings) appear in the reader. | `9c2648c`, `e40cc43`, `66c719c` |
| 4. Duty log | Owners and conductors record each trip: bus, driver, conductor, direction. Every passenger review is now linked to the crew who were actually on that trip. Dates are shown in BS beside AD. Conductors get a simple phone screen with a crew-only login. | `1f970e3`, `41456e7`, `2702837` |
| 5. One QR per bus | Every bus gets one sticker. Scanning it opens the magazine first; the "How's this bus?" rating comes later, at a polite moment. Stickers print as PNG, SVG or PDF (A6 and seat-back), in English and Nepali, singly or for the whole fleet. Old stickers keep working. | `21f4b6f` |
| 6. Scorecards and appraisals | Each driver gets a fair score (it is not ranked until there are 10 reviews), a monthly trend, praise and complaint words, fuel use (km per litre) and licence expiry. Owners write appraisals that drivers acknowledge, and can download them as a PDF. Owners can dispute a review given to the wrong crew; Batoma moderators decide. | `3967d66` |
| 7. Income records | Daily takings per bus, from each ticket source (counter, Bussewa, eSewa and others), entered by hand or imported from CSV or Excel without duplicates. Reports show revenue, tickets, revenue per km and operating profit. Turned off until the owner switches it on, and protected by an authenticator app. Managers see totals only if the owner allows it. | `2f19849` |
| 8. Reading experience | Stories have a one-line summary and "In brief" points, a progress bar, "Continue reading", "Up next" and "Continue where you left off". Stops along the road are shown in travel order ("Coming up", "Later on the road", "At the destination"), with open/closed status and Call, WhatsApp and Directions buttons. | `38664f9` |
| 9. Public website | A separate website for search engines and the public: magazine, trips and places, partners and deals, write a trip, advertise, about, contact, newsletter. It works with no JavaScript at all, has no links to buses or QR codes, and reads the database through a read-only account. Businesses get their own area (enquiries, deals, reviews, monthly report). | `00e1b6d` |
| 10. Security | Sign-in protection (delays and lockouts after wrong passwords), recovery codes, new-device emails, "sign out everywhere", stronger passwords, encrypted personal fields, cleaned uploads (location data removed from photos), private verification documents, data export and account deletion for travellers, old scan data summarised after 13 months, and a Security events screen for admins. No page runs inline code any more. | `634055e`, `2b0850f`, `aa222d0`, `cd4ba46`, `a3ae655` |
| 11. Ready to host | A Render blueprint (`render.yaml`) for the API, the app, the website, the database and a weekly encrypted backup. Production refuses to start if a setting is missing or unsafe. A first-admin script and a live smoke test. | `3351a95` |

---

## 3. Test results (last run, commit `3351a95`)

| Check | Result |
|---|---|
| Type checks (normal and strict) | clean |
| Unit tests | 254 passed |
| Smoke tests against the running app | 593 checks passed (fleet 114, programming 58, trips 51, QR 32, appraisals 82, income 93, website 79, security 84) |
| Website tests | 24 passed |
| Access test ("can one company see another's data?") | 193 attempts, every one refused |
| GitHub Actions (runs on every push) | green |
| ZAP security scan | no high-risk findings |
| `npm audit` | no high or critical warnings |
| Website speed and quality (Lighthouse, phone) | 99 performance, 100 accessibility, 100 best practice, 100 SEO on most pages |

Two Lighthouse exceptions, both expected: a place page with a Nepali name scores 92–94 for
speed because of the Devanagari font; Privacy and Terms score 66 for SEO because they are
hidden from search engines until a lawyer approves them.

---

## 4. Decisions to know about

- **Prices** for advertising packages are not set: you type them into the control panel
  (Website → Partner packages).
- **Privacy and Terms** are drafts, marked "Draft: needs legal review" and kept out of
  search until approved.
- **The sticker address can never change** once printed: `https://<your domain>/b/<code>`.
  Choose the domain carefully and renew it for several years.
- **Database-level row security** was tried for fleet and finance data and not used; every
  route checks company membership instead, and the access test above proves it. The
  reasons are in `DECISIONS.md`.
- **Money** is stored in paisa (whole numbers), so totals never have rounding errors.

---

## 5. What only you can do (in order)

Full detail in `GO_LIVE.md`.

1. Choose the domain (for example `batoma.com.np`).
2. Have Privacy and Terms reviewed by a lawyer.
3. Decide advertising package prices.
4. Create accounts: Render (a plan with point-in-time recovery), Cloudflare R2 (three
   buckets), an email provider (SMTP), and optionally Sentry.
5. Make a backup key with `age` and keep it in your password manager.
6. In Render: New → Blueprint, fill in the settings `GO_LIVE.md` lists, then copy the two
   encryption keys into your password manager straight away.
7. Point the domain's DNS at Render, create the first admin, set up the authenticator and
   save the recovery codes.
8. Register a "TEST Batoma" company with one bus, print its sticker and scan it.
9. Then Claude runs the live smoke test (`scripts/prod_smoke.sh`) and checks the
   production-only items: real client addresses, emails arriving, pictures and private files.

---

## 6. Open questions for you

- **Unverified businesses in the app.** The website shows verified businesses only; the
  app still lists unverified ones. Should the app match the website?
- **Left for later** (not in the Phase 3 brief, listed in `GAPS.md`): offline maps,
  comments and bookmarks, the itinerary builder, traveller privacy settings, article
  translations, and eSewa/Khalti payments.
