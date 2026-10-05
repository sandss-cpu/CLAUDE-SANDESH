# Threat model

What could go wrong with Batoma, who would do it, and what stops them. STRIDE (spoofing,
tampering, repudiation, information disclosure, denial of service, elevation of privilege)
across the six areas the Phase 3 brief names. Each control points at the code or test that
enforces it. Updated for Phase 3, step 10 (October 2026).

## The system in one paragraph

Three public services: the **API** (NestJS, `backend/`), the **web app** (static pages in
`web/`: the reader opened from a bus sticker, sign-in, the owner portal, the partner area,
the control panel) and the **public website** (`site/`, server-rendered, no script). One
PostgreSQL database. Private files (statement photos, verification documents) in private
object storage, reached only through short-lived signed links. The website reads through
its own read-only database role and posts forms to the API with a shared key.

## Who we defend against

| Actor | Wants | Typical means |
|---|---|---|
| A rival bus company | Sink a competitor's ratings, read its income, poach drivers | Fake reviews, guessing ids, a stolen manager account |
| A dishonest staff member of a company | Hide a bad trip, inflate income, blame another driver | Editing records after the fact, misattributing reviews |
| A spammer or scraper | Free advertising, harvested contacts | Form floods, crawling partner pages, fake listings |
| An account thief | A partner's or owner's account, a traveller's data | Password spraying, phished passwords, stolen phones |
| A curious traveller | Who reviewed the bus, other travellers' data | Changing ids in requests, reading page source |
| An insider at Batoma | More access than their role | Using an admin token beyond its purpose |

## 1. QR scans (the reader, `/b/<code>`)

| | Threat | Control |
|---|---|---|
| S | A forged sticker sends travellers to a look-alike site | Stickers encode one fixed short-link domain (`SHORT_LINK_BASE`, https enforced in production); the reader only follows codes it can resolve on the API |
| T | A code is changed to point at another bus | Codes are made server-side, rotated only by the company's owner or manager or an admin (`qr.rotate`, audited); a rotated code answers "no longer active" |
| R | A company denies rotating a code | Every rotation is in `audit_events` with actor and time |
| I | Scans reveal who rode which bus | A scan stores the code, time, a random device session and a salted address hash; no account, no location. Raw scans are rolled up to daily counts after 13 months (`RetentionService`) |
| D | Scan floods inflate counts or slow the API | 60 resolves a minute per address (`qr.controller.ts`, generous for bus Wi-Fi); the offline pack means a reader needs one scan per ride |
| E | A scan token used as a session | Scan tokens are scoped (`scope` claim); `JwtStrategy` refuses any scoped token as a session |

## 2. Reviews (buses and partners)

| | Threat | Control |
|---|---|---|
| S | A rival writes one-star reviews without riding | A bus review needs a fresh scan token from that bus (12 hours) or a confirmed account; one review per ride; reviews are moderated before they show |
| T | An owner edits or deletes bad reviews | Owners can reply or report only; moderation is Batoma's (`review.crew` audited when a moderator reattributes) |
| R | A reviewer denies writing abuse | Reviews keep the scan link and an address hash (cleared after 13 months) for moderators |
| I | An owner learns who reviewed | The owner sees text and scores, never the reviewer; public pages show no names (`publicReview()`) |
| D | Review floods | 20 bus reviews / 10 partner reviews per address per 15 minutes; moderation queue |
| E | A driver is blamed for another's trip | Reviews are attributed from the trip covering that moment (duty log); a wrong crew can be disputed (`WRONG_CREW`) and moderated |

## 3. Finance (income records)

| | Threat | Control |
|---|---|---|
| S | Someone signs in as the owner | Turning income records on requires an authenticator; from then the owner's sign-in always asks for it; lockout after repeated failures |
| T | Income edited after the fact | Entries lock after 7 days; every create, edit, delete, import and undo is in `audit_events` with before and after |
| R | "I never deleted that" | Soft delete with `deletedById`; the audit trail |
| I | A manager or rival reads totals | `FinanceAccessService` is the single check: managers see totals only if the owner allows; another company gets 404 (IDOR suite); statement photos are private and re-encoded; notes are encrypted at rest |
| D | Import of a huge or malicious sheet | 5 MB cap, in-house CSV and XLSX readers (no `xlsx` package), 10 imports per 15 minutes |
| E | A manager turns finance on or changes sources | Owner-only (`OWN` level), tested in the IDOR suite |

## 4. Partner links and the public website

| | Threat | Control |
|---|---|---|
| S | A fake business is listed | Listings appear on the website only once verified by staff (row-level security on the site role); verification documents are reviewed privately; `business.verify` is audited |
| T | Click or impression counts inflated to dispute a bill | One click per visit (partial unique index), bots not counted, 60 counted clicks a minute per address; counts are recorded server-side only |
| R | A partner disputes the report | The report is plain counts of recorded events by Kathmandu day, downloadable as CSV and PDF |
| I | Drafts, unverified listings or owner details leak through the website | The website connects as `batoma_site`: column grants and row-level security (`backend/prisma/site-role.sql`); a crawler test fails on any bus, QR or fleet link |
| D | Form spam | The API accepts website forms only with the site's key; honeypot, signed time token, 10 posts per address per 10 minutes; leads 30 a minute |
| E | XSS on the website or in the app | No script on any website page (`script-src 'none'`); the web app's CSP is `script-src 'self'` with no inline code anywhere (tested); everything interpolated is escaped |

## 5. Uploads (photos, statements, documents)

| | Threat | Control |
|---|---|---|
| S | A file named `.jpg` that is something else | File signatures checked, then the image is decoded and drawn again as WebP; anything that fails is refused |
| T | A malicious PDF | PDFs with JavaScript, launch actions, attachments or XFA are refused; PDFs are only ever downloaded (`Content-Disposition: attachment`), never shown on our origin |
| R | — | Uploads of documents are audited (`verification.upload`, `verification.delete`, `verification.view`) |
| I | A phone photo carries its GPS position | Re-encoding drops all metadata (EXIF, GPS, camera); private files are served only through links that expire in five minutes |
| D | Decompression bombs, huge files | 8 MB (images) and 10 MB (documents) caps; 40 megapixel decode limit; 30 uploads per 10 minutes |
| E | Uploads executed as script | Private files are served with `Content-Security-Policy: sandbox` and `nosniff`; public uploads should be served from a separate origin in production |

## 6. Accounts and sessions (all of the above depend on these)

| | Threat | Control |
|---|---|---|
| S | Password spraying, credential stuffing | argon2id; lockout per account and per address hash with lengthening waits up to 15 minutes; 10-character minimum and a 10,000-word common-password list; equal timing for unknown emails |
| S | Phished or stolen password | Authenticator required for staff and finance owners, optional for everyone else and always asked once set up; email alert on a new browser |
| T | A stolen refresh token reused | Rotation with reuse detection kills the whole family |
| R | Disputed admin actions | Role changes, suspensions, authenticator resets, exports and document views are in the Security events view |
| I | Tokens or personal data in logs | JSON logs with redaction (emails, phones, tokens, signed-link parameters); no request bodies; Sentry scrubbing |
| D | Lockout used to keep someone out | Locks are short (at most 15 minutes) and lift on their own; a password reset is always possible |
| E | A role change not taking effect | `JwtStrategy` reads the user on every request; role changes, suspensions, resets and "sign out everywhere" end existing tokens at once (`sessionsValidFrom`) |

## Residual risks we accept, for now

- **Row-level security is not used for fleet and finance tables.** Evaluated and declined
  (DECISIONS.md, step 10): the single access layer plus the generated IDOR suite cover it.
- **A determined scraper can read the public website.** It is public on purpose; nothing
  private is reachable through the site's role.
- **Lead and enquiry messages are stored in clear** (contacts are encrypted). They are
  short, written to be read by a partner, and deleting them is a moderator action.
- **The newsletter address list is not encrypted**: it must be unique and is exported for
  sending. It is admin-only and exports are audited.
- **Verification is manual.** A convincing forger with real-looking documents could be
  verified; staff can suspend a listing or company at once.
