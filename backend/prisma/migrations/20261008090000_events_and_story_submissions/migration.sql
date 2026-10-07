-- Events and happenings for the website, and stories sent from its "Write a trip" page.
-- New tables only: nothing existing changes, so there is nothing to backfill.

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventCategory" AS ENUM ('FESTIVAL', 'MUSIC', 'FOOD', 'CULTURE', 'SPORT', 'OUTDOORS', 'MARKET', 'EXHIBITION', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('AWAITING_EMAIL', 'SUBMITTED', 'FEATURED', 'DECLINED');

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleNe" TEXT,
    "summary" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" "EventCategory" NOT NULL DEFAULT 'OTHER',
    "city" TEXT NOT NULL,
    "venue" TEXT,
    "address" TEXT,
    "destinationId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "priceLabel" TEXT,
    "organiser" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "place" TEXT,
    "body" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'AWAITING_EMAIL',
    "confirmTokenHash" TEXT,
    "confirmBy" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "editorNote" TEXT,
    "articleId" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_startsAt_idx" ON "events"("status", "startsAt");

-- CreateIndex
CREATE INDEX "events_city_idx" ON "events"("city");

-- CreateIndex
CREATE UNIQUE INDEX "story_submissions_confirmTokenHash_key" ON "story_submissions"("confirmTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "story_submissions_articleId_key" ON "story_submissions"("articleId");

-- CreateIndex
CREATE INDEX "story_submissions_status_submittedAt_idx" ON "story_submissions"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "story_submissions_userId_idx" ON "story_submissions"("userId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_submissions" ADD CONSTRAINT "story_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_submissions" ADD CONSTRAINT "story_submissions_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- An event cannot end before it starts.
ALTER TABLE "events" ADD CONSTRAINT "events_ends_after_start" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt");
