-- More marketing slots, and ads that can be aimed at the routes a traveller is on.

-- AlterEnum: eight new places an ad can appear
ALTER TYPE "AdPlacement" ADD VALUE 'VLOG_FEED';
ALTER TYPE "AdPlacement" ADD VALUE 'TRIP_PLANNER';
ALTER TYPE "AdPlacement" ADD VALUE 'ROUTE_GUIDE';
ALTER TYPE "AdPlacement" ADD VALUE 'MAP_SCREEN';
ALTER TYPE "AdPlacement" ADD VALUE 'MORE_SCREEN';
ALTER TYPE "AdPlacement" ADD VALUE 'BUS_PAGE';
ALTER TYPE "AdPlacement" ADD VALUE 'CREATOR_PROFILE';
ALTER TYPE "AdPlacement" ADD VALUE 'SEARCH_RESULTS';

-- CreateTable: an ad with no rows here shows on every route
CREATE TABLE "ad_route_targets" (
    "adId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,

    CONSTRAINT "ad_route_targets_pkey" PRIMARY KEY ("adId","routeId")
);

-- CreateIndex
CREATE INDEX "ad_route_targets_routeId_idx" ON "ad_route_targets"("routeId");

-- AddForeignKey
ALTER TABLE "ad_route_targets" ADD CONSTRAINT "ad_route_targets_adId_fkey" FOREIGN KEY ("adId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_route_targets" ADD CONSTRAINT "ad_route_targets_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
