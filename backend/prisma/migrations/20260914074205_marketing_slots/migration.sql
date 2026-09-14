-- CreateEnum
CREATE TYPE "AdPlacement" AS ENUM ('TOP_BANNER', 'BETWEEN_STORIES', 'ARTICLE_TOP', 'ARTICLE_BOTTOM');

-- CreateEnum
CREATE TYPE "AdDurationUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "AdLinkType" AS ENUM ('EXTERNAL', 'OVERVIEW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAct" ADD VALUE 'CREATE';
ALTER TYPE "ModerationAct" ADD VALUE 'UPDATE';
ALTER TYPE "ModerationAct" ADD VALUE 'PAUSE';
ALTER TYPE "ModerationAct" ADD VALUE 'RESUME';

-- AlterEnum
ALTER TYPE "TargetType" ADD VALUE 'AD';

-- CreateTable
CREATE TABLE "advertisements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "advertiserName" TEXT NOT NULL,
    "tagline" TEXT,
    "imageUrl" TEXT NOT NULL,
    "placement" "AdPlacement" NOT NULL,
    "durationUnit" "AdDurationUnit" NOT NULL,
    "durationCount" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "linkType" "AdLinkType" NOT NULL,
    "externalUrl" TEXT,
    "overviewTitle" TEXT,
    "overviewBody" TEXT,
    "overviewImageUrl" TEXT,
    "businessId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advertisements_placement_isActive_startsAt_endsAt_idx" ON "advertisements"("placement", "isActive", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
