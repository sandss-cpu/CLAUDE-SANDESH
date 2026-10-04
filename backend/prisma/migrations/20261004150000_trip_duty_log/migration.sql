-- Driver duty log (Phase 3, Feature 5, part one).
--
-- A Trip is one run of one bus in one direction, and who crewed it. Reviews gain the
-- trip, driver and conductor they belong to, set by the server; existing reviews are
-- attributed below from the crew assignment that covered the moment they were written.
-- Operator members gain a CREW role that can only start and end trips.

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripSource" AS ENUM ('MANUAL', 'ASSIGNMENT_DEFAULT');

-- AlterEnum
ALTER TYPE "OperatorMemberRole" ADD VALUE 'CREW';

-- AlterTable
ALTER TABLE "ride_feedback" ADD COLUMN     "conductorId" TEXT,
ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "tripId" TEXT;

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "routeId" TEXT,
    "direction" "GuideDirection" NOT NULL,
    "departAt" TIMESTAMP(3) NOT NULL,
    "arriveAt" TIMESTAMP(3),
    "driverId" TEXT,
    "conductorId" TEXT,
    "helperId" TEXT,
    "source" "TripSource" NOT NULL DEFAULT 'MANUAL',
    "status" "TripStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startOdometerKm" INTEGER,
    "endOdometerKm" INTEGER,
    "createdById" TEXT,
    "unlockedUntil" TIMESTAMP(3),
    "unlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trips_vehicleId_departAt_idx" ON "trips"("vehicleId", "departAt");

-- CreateIndex
CREATE INDEX "trips_vehicleId_status_idx" ON "trips"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "trips_operatorId_departAt_idx" ON "trips"("operatorId", "departAt");

-- CreateIndex
CREATE INDEX "trips_driverId_departAt_idx" ON "trips"("driverId", "departAt");

-- CreateIndex
CREATE INDEX "ride_feedback_driverId_createdAt_idx" ON "ride_feedback"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "ride_feedback_tripId_idx" ON "ride_feedback"("tripId");

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A run always goes one way, arrives after it leaves, and its odometer only goes up.
ALTER TABLE "trips" ADD CONSTRAINT "trip_direction" CHECK ("direction" IN ('FORWARD', 'REVERSE'));
ALTER TABLE "trips" ADD CONSTRAINT "trip_times" CHECK ("arriveAt" IS NULL OR "arriveAt" > "departAt");
ALTER TABLE "trips" ADD CONSTRAINT "trip_odometer" CHECK (
    ("startOdometerKm" IS NULL OR "startOdometerKm" >= 0)
AND ("endOdometerKm" IS NULL OR "endOdometerKm" >= 0)
AND ("startOdometerKm" IS NULL OR "endOdometerKm" IS NULL OR "endOdometerKm" >= "startOdometerKm")
);
-- One bus is on one trip at a time.
CREATE UNIQUE INDEX "trip_one_in_progress" ON "trips" ("vehicleId") WHERE "status" = 'IN_PROGRESS';

-- Backfill: existing reviews go to the driver and conductor assigned to that bus when
-- the review was written. There are no trips yet, so tripId stays empty.
UPDATE "ride_feedback" f SET "driverId" = (
    SELECT da."driverId" FROM "driver_assignments" da JOIN "drivers" d ON d."id" = da."driverId"
     WHERE da."vehicleId" = f."vehicleId" AND d."role" = 'DRIVER'
       AND da."startedAt" <= f."createdAt" AND (da."endedAt" IS NULL OR da."endedAt" > f."createdAt")
     ORDER BY da."startedAt" DESC LIMIT 1)
 WHERE f."vehicleId" IS NOT NULL;
UPDATE "ride_feedback" f SET "conductorId" = (
    SELECT da."driverId" FROM "driver_assignments" da JOIN "drivers" d ON d."id" = da."driverId"
     WHERE da."vehicleId" = f."vehicleId" AND d."role" = 'CONDUCTOR'
       AND da."startedAt" <= f."createdAt" AND (da."endedAt" IS NULL OR da."endedAt" > f."createdAt")
     ORDER BY da."startedAt" DESC LIMIT 1)
 WHERE f."vehicleId" IS NOT NULL;
