-- The public website (Feature 3): web ad placements with section and destination targets,
-- richer leads, partner packages, the newsletter (double opt-in), the site's own
-- append-only analytics, the enquiry inbox, and slugs for road guides' clean URLs.
--
-- The site's read-only database role and its row-level policies are not here: creating a
-- role needs a privilege managed databases may not grant a migration. They live in
-- prisma/site-role.sql, applied with npm run db:site-role (GO_LIVE.md).

-- CreateEnum
CREATE TYPE "LeadChannel" AS ENUM ('APP', 'SITE');

-- CreateEnum
CREATE TYPE "PackageKind" AS ENUM ('HOME_HERO', 'SECTION_SPONSOR', 'SPONSORED_ARTICLE', 'DESTINATION_SPONSOR', 'DEALS', 'NEWSLETTER', 'LISTING');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "SiteEventType" AS ENUM ('PAGE_VIEW', 'IMPRESSION', 'CLICK');

-- CreateEnum
CREATE TYPE "EnquiryKind" AS ENUM ('ADVERTISE', 'CONTACT');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'HANDLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdPlacement" ADD VALUE 'WEB_HOME_HERO';
ALTER TYPE "AdPlacement" ADD VALUE 'WEB_SECTION_SPONSOR';
ALTER TYPE "AdPlacement" ADD VALUE 'WEB_SPONSORED_ARTICLE';
ALTER TYPE "AdPlacement" ADD VALUE 'WEB_DESTINATION_SPONSOR';
ALTER TYPE "AdPlacement" ADD VALUE 'WEB_DEALS';
ALTER TYPE "AdPlacement" ADD VALUE 'WEB_NEWSLETTER';

-- AlterTable
ALTER TABLE "business_leads" ADD COLUMN     "channel" "LeadChannel" NOT NULL DEFAULT 'APP',
ADD COLUMN     "contact" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "advertisements" ADD COLUMN     "targetCategoryId" TEXT,
ADD COLUMN     "targetDestinationId" TEXT;

-- AlterTable
ALTER TABLE "route_guides" ADD COLUMN "slug" TEXT;

-- Backfill: each guide's title as a URL slug; a repeated title gets the start of its id.
WITH base AS (
  SELECT id, coalesce(nullif(trim(both '-' from lower(regexp_replace(title, '[^A-Za-z0-9]+', '-', 'g'))), ''), 'guide') AS s
  FROM "route_guides"
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS n FROM base
)
UPDATE "route_guides" g SET "slug" = CASE WHEN n.n = 1 THEN n.s ELSE n.s || '-' || left(g.id, 6) END
FROM numbered n WHERE g.id = n.id;
ALTER TABLE "route_guides" ALTER COLUMN "slug" SET NOT NULL;

-- CreateTable
CREATE TABLE "partner_packages" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "PackageKind" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "pricePaisa" INTEGER,
    "status" "PackageStatus" NOT NULL DEFAULT 'PROPOSED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "confirmTokenHash" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "source" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_events" (
    "id" BIGSERIAL NOT NULL,
    "type" "SiteEventType" NOT NULL,
    "path" TEXT NOT NULL,
    "target" TEXT,
    "businessId" TEXT,
    "adId" TEXT,
    "articleId" TEXT,
    "sessionHash" TEXT NOT NULL,
    "referrerHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_enquiries" (
    "id" TEXT NOT NULL,
    "kind" "EnquiryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "organisation" TEXT,
    "message" TEXT NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_packages_businessId_startsAt_idx" ON "partner_packages"("businessId", "startsAt");

-- CreateIndex
CREATE INDEX "partner_packages_status_endsAt_idx" ON "partner_packages"("status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_unsubscribeToken_key" ON "newsletter_subscribers"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "site_events_type_createdAt_idx" ON "site_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "site_events_businessId_type_createdAt_idx" ON "site_events"("businessId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "site_events_adId_type_createdAt_idx" ON "site_events"("adId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "site_enquiries_status_createdAt_idx" ON "site_enquiries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "route_guides_slug_key" ON "route_guides"("slug");

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_targetCategoryId_fkey" FOREIGN KEY ("targetCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_targetDestinationId_fkey" FOREIGN KEY ("targetDestinationId") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_packages" ADD CONSTRAINT "partner_packages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A /go/ click counts once per visit: one row per target and visit hash.
CREATE UNIQUE INDEX "site_click_once" ON "site_events" ("target", "sessionHash") WHERE "type" = 'CLICK';

ALTER TABLE "partner_packages" ADD CONSTRAINT "package_dates" CHECK ("endsAt" > "startsAt");
ALTER TABLE "partner_packages" ADD CONSTRAINT "package_price" CHECK ("pricePaisa" IS NULL OR "pricePaisa" >= 0);
