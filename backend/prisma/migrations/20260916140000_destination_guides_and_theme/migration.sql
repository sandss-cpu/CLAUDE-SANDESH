-- Guides can now belong to a destination as a day-by-day itinerary, not only to a
-- route; and the platform's colours and background become an admin setting.

-- CreateEnum
CREATE TYPE "GuideKind" AS ENUM ('ROUTE', 'DESTINATION');

-- AlterTable: a guide is attached to a route or to a destination
ALTER TABLE "route_guides" ADD COLUMN     "kind" "GuideKind" NOT NULL DEFAULT 'ROUTE',
ADD COLUMN     "destinationId" TEXT,
ADD COLUMN     "dayCount" INTEGER,
ALTER COLUMN "routeId" DROP NOT NULL;

-- AlterTable: which day of an itinerary a stop belongs to
ALTER TABLE "route_guide_stops" ADD COLUMN     "dayNumber" INTEGER;

-- CreateIndex
CREATE INDEX "route_guides_destinationId_status_idx" ON "route_guides"("destinationId", "status");

-- AddForeignKey
ALTER TABLE "route_guides" ADD CONSTRAINT "route_guides_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: a single row holds the platform's appearance
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'app',
    "themePalette" TEXT NOT NULL DEFAULT 'prayer-flag',
    "themeBackground" TEXT NOT NULL DEFAULT 'none',
    "appName" TEXT NOT NULL DEFAULT 'Batoma',
    "tagline" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_settings" ("id", "updatedAt") VALUES ('app', CURRENT_TIMESTAMP);
