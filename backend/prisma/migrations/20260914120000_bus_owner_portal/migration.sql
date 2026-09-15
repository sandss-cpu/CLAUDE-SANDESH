-- Bus owner portal: companies and membership roles, bus registration, passenger
-- reviews, maintenance, breakdowns, documents, crew, fuel and reminders.

-- CreateEnum
CREATE TYPE "OperatorVerification" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OperatorMemberRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateEnum
CREATE TYPE "BusStatus" AS ENUM ('ACTIVE', 'IN_MAINTENANCE', 'OFF_ROAD');

-- CreateEnum
CREATE TYPE "QrKind" AS ENUM ('SEAT', 'BUS', 'COMPANY');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('ROUTINE_SERVICE', 'REPAIR', 'PARTS_REPLACEMENT', 'INSPECTION', 'TYRES', 'BODYWORK', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('BREAKDOWN', 'ACCIDENT', 'FLAT_TYRE', 'ENGINE', 'BRAKES', 'ELECTRICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BusDocumentType" AS ENUM ('BLUEBOOK', 'ROUTE_PERMIT', 'INSURANCE', 'POLLUTION_CERTIFICATE', 'FITNESS_CERTIFICATE', 'TAX_CLEARANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DriverRole" AS ENUM ('DRIVER', 'CONDUCTOR', 'HELPER');

-- AlterEnum
ALTER TYPE "TargetType" ADD VALUE 'BUS_REVIEW';
ALTER TYPE "TargetType" ADD VALUE 'OPERATOR';

-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "ride_feedback" DROP CONSTRAINT "ride_feedback_vehicleId_fkey";

-- AlterTable
ALTER TABLE "operator_admins" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "role" "OperatorMemberRole" NOT NULL DEFAULT 'OWNER';

-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "registrationNo" TEXT,
ADD COLUMN     "verification" "OperatorVerification" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- Operators that already exist were created by a Bato admin, so they start verified.
UPDATE "operators" SET "verification" = 'VERIFIED', "verifiedAt" = CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "qr_codes" ADD COLUMN     "kind" "QrKind" NOT NULL DEFAULT 'SEAT';

-- AlterTable
ALTER TABLE "ride_feedback" ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "moderation" "ModerationStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "overall" INTEGER,
ADD COLUMN     "ownerRepliedAt" TIMESTAMP(3),
ADD COLUMN     "ownerReply" TEXT,
ADD COLUMN     "qrCodeId" TEXT,
ADD COLUMN     "suggestion" TEXT,
ADD COLUMN     "tripDate" TIMESTAMP(3),
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "sessionId" DROP NOT NULL,
ALTER COLUMN "cleanliness" DROP NOT NULL,
ALTER COLUMN "driving" DROP NOT NULL,
ALTER COLUMN "punctuality" DROP NOT NULL,
ALTER COLUMN "staff" DROP NOT NULL;

-- Earlier feedback only had the four part scores; their rounded average becomes the overall rating.
UPDATE "ride_feedback"
   SET "overall" = GREATEST(1, LEAST(5, ROUND(("cleanliness" + "driving" + "punctuality" + "staff") / 4.0)))
 WHERE "overall" IS NULL;
ALTER TABLE "ride_feedback" ALTER COLUMN "overall" SET NOT NULL;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "busType" TEXT,
ADD COLUMN     "colour" TEXT,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "odometerKm" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "plateKey" TEXT,
ADD COLUMN     "serviceIntervalDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "serviceIntervalKm" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "status" "BusStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "year" INTEGER;

-- Same normalisation as normalisePlate() in fleet.util.ts: upper case, letters and digits only.
UPDATE "vehicles" SET "plateKey" = UPPER(REGEXP_REPLACE("plateNo", '[^[:alnum:]]', '', 'g'));
ALTER TABLE "vehicles" ALTER COLUMN "plateKey" SET NOT NULL;

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "MaintenanceKind" NOT NULL DEFAULT 'ROUTINE_SERVICE',
    "servicedAt" TIMESTAMP(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "workshop" TEXT,
    "costNpr" INTEGER,
    "partsReplaced" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nextDueDate" TIMESTAMP(3),
    "nextDueKm" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_incidents" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "IncidentKind" NOT NULL DEFAULT 'BREAKDOWN',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MAJOR',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "odometerKm" INTEGER,
    "description" TEXT NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "driverId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "repairCostNpr" INTEGER,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_documents" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "type" "BusDocumentType" NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "photoUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "DriverRole" NOT NULL DEFAULT 'DRIVER',
    "licenceNumber" TEXT,
    "licenceExpiresAt" TIMESTAMP(3),
    "photoUrl" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_logs" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "litres" DOUBLE PRECISION NOT NULL,
    "costNpr" INTEGER NOT NULL,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "station" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_notifications" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_records_vehicleId_servicedAt_idx" ON "maintenance_records"("vehicleId", "servicedAt");

-- CreateIndex
CREATE INDEX "bus_incidents_vehicleId_status_idx" ON "bus_incidents"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "bus_documents_vehicleId_idx" ON "bus_documents"("vehicleId");

-- CreateIndex
CREATE INDEX "bus_documents_expiresAt_idx" ON "bus_documents"("expiresAt");

-- CreateIndex
CREATE INDEX "drivers_operatorId_isActive_idx" ON "drivers"("operatorId", "isActive");

-- CreateIndex
CREATE INDEX "driver_assignments_vehicleId_endedAt_idx" ON "driver_assignments"("vehicleId", "endedAt");

-- CreateIndex
CREATE INDEX "driver_assignments_driverId_endedAt_idx" ON "driver_assignments"("driverId", "endedAt");

-- CreateIndex
CREATE INDEX "fuel_logs_vehicleId_filledAt_idx" ON "fuel_logs"("vehicleId", "filledAt");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_notifications_dedupeKey_key" ON "fleet_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "fleet_notifications_operatorId_readAt_createdAt_idx" ON "fleet_notifications"("operatorId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "operator_admins_userId_idx" ON "operator_admins"("userId");

-- CreateIndex
CREATE INDEX "operators_verification_idx" ON "operators"("verification");

-- CreateIndex
CREATE INDEX "qr_codes_vehicleId_kind_isActive_idx" ON "qr_codes"("vehicleId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "ride_feedback_vehicleId_moderation_createdAt_idx" ON "ride_feedback"("vehicleId", "moderation", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plateKey_key" ON "vehicles"("plateKey");

-- CreateIndex
CREATE INDEX "vehicles_operatorId_isActive_idx" ON "vehicles"("operatorId", "isActive");

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_feedback" ADD CONSTRAINT "ride_feedback_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_incidents" ADD CONSTRAINT "bus_incidents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_incidents" ADD CONSTRAINT "bus_incidents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_documents" ADD CONSTRAINT "bus_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_notifications" ADD CONSTRAINT "fleet_notifications_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_notifications" ADD CONSTRAINT "fleet_notifications_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
