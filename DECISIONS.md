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
