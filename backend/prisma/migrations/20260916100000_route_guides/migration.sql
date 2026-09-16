-- Route guides: what an editor curates along a corridor (landmarks, food, hotels),
-- shown to travellers according to where they are heading.

-- CreateEnum
CREATE TYPE "GuideStopKind" AS ENUM ('LANDMARK', 'VIEWPOINT', 'FOOD', 'HOTEL', 'REST_STOP', 'FUEL', 'ATM', 'HOSPITAL', 'TEMPLE', 'SHOPPING', 'ACTIVITY', 'OTHER');

-- CreateEnum
CREATE TYPE "GuideDirection" AS ENUM ('BOTH', 'FORWARD', 'REVERSE');

-- CreateTable
CREATE TABLE "route_guides" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "direction" "GuideDirection" NOT NULL DEFAULT 'BOTH',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "coverImageUrl" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_guide_stops" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "kind" "GuideStopKind" NOT NULL DEFAULT 'LANDMARK',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "distanceFromStartKm" INTEGER,
    "minutesFromStart" INTEGER,
    "priceFromNpr" INTEGER,
    "openingHours" TEXT,
    "contactPhone" TEXT,
    "tip" TEXT,
    "placeId" TEXT,
    "businessId" TEXT,
    "isHighlight" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_guide_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_guides_routeId_status_idx" ON "route_guides"("routeId", "status");

-- CreateIndex
CREATE INDEX "route_guide_stops_guideId_sortOrder_idx" ON "route_guide_stops"("guideId", "sortOrder");

-- AddForeignKey
ALTER TABLE "route_guides" ADD CONSTRAINT "route_guides_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_guide_stops" ADD CONSTRAINT "route_guide_stops_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "route_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_guide_stops" ADD CONSTRAINT "route_guide_stops_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_guide_stops" ADD CONSTRAINT "route_guide_stops_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
