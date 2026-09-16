-- Creator profiles: travellers an admin gives creator access, with journeys that
-- group their posts into one trip, including route, length, cost and gear.

-- CreateEnum
CREATE TYPE "CreatorStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED');

-- CreateTable
CREATE TABLE "creator_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "coverUrl" TEXT,
    "homeBase" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "websiteUrl" TEXT,
    "instagram" TEXT,
    "youtube" TEXT,
    "status" "CreatorStatus" NOT NULL DEFAULT 'PENDING',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_journeys" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "coverImageUrl" TEXT,
    "routeId" TEXT,
    "destinationId" TEXT,
    "startedOn" TIMESTAMP(3),
    "dayCount" INTEGER,
    "transportNpr" INTEGER,
    "stayNpr" INTEGER,
    "foodNpr" INTEGER,
    "permitsNpr" INTEGER,
    "otherNpr" INTEGER,
    "gear" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tips" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_journey_posts" (
    "journeyId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "dayNumber" INTEGER,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "creator_journey_posts_pkey" PRIMARY KEY ("journeyId","postId")
);

-- CreateIndex
CREATE UNIQUE INDEX "creator_profiles_userId_key" ON "creator_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_profiles_handle_key" ON "creator_profiles"("handle");

-- CreateIndex
CREATE INDEX "creator_profiles_status_isFeatured_idx" ON "creator_profiles"("status", "isFeatured");

-- CreateIndex
CREATE INDEX "creator_journeys_status_publishedAt_idx" ON "creator_journeys"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "creator_journeys_creatorId_slug_key" ON "creator_journeys"("creatorId", "slug");

-- CreateIndex
CREATE INDEX "creator_journey_posts_postId_idx" ON "creator_journey_posts"("postId");

-- AddForeignKey
ALTER TABLE "creator_profiles" ADD CONSTRAINT "creator_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_journeys" ADD CONSTRAINT "creator_journeys_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creator_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_journeys" ADD CONSTRAINT "creator_journeys_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_journeys" ADD CONSTRAINT "creator_journeys_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_journey_posts" ADD CONSTRAINT "creator_journey_posts_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "creator_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_journey_posts" ADD CONSTRAINT "creator_journey_posts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
