-- Driver scorecards and appraisals (Feature 5, part two).
--
-- Nothing to backfill: appraisals are new, and scorecards are computed from trips,
-- reviews, fuel and incidents already recorded. ALTER TYPE ... ADD VALUE is allowed in
-- a transaction on PostgreSQL 12+; the new values are not used until it commits.

-- CreateEnum
CREATE TYPE "AppraisalOutcome" AS ENUM ('NONE', 'COMMENDATION', 'BONUS', 'TRAINING', 'WARNING');

-- CreateEnum
CREATE TYPE "AppraisalStatus" AS ENUM ('DRAFT', 'FINAL');

-- AlterEnum
ALTER TYPE "ReportReason" ADD VALUE 'WRONG_CREW';

-- AlterEnum
ALTER TYPE "ModerationAct" ADD VALUE 'REASSIGN_CREW';

-- CreateTable
CREATE TABLE "driver_appraisals" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "drivingScore" INTEGER,
    "punctualityScore" INTEGER,
    "conductScore" INTEGER,
    "safetyScore" INTEGER,
    "vehicleCareScore" INTEGER,
    "attendanceScore" INTEGER,
    "suggested" JSONB,
    "comments" TEXT,
    "strengths" TEXT,
    "goals" TEXT,
    "outcome" "AppraisalOutcome" NOT NULL DEFAULT 'NONE',
    "appraiserId" TEXT,
    "status" "AppraisalStatus" NOT NULL DEFAULT 'DRAFT',
    "finalisedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_appraisals_operatorId_createdAt_idx" ON "driver_appraisals"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "driver_appraisals_driverId_periodEnd_idx" ON "driver_appraisals"("driverId", "periodEnd");

-- AddForeignKey
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "driver_appraisals_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "driver_appraisals_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "driver_appraisals_appraiserId_fkey" FOREIGN KEY ("appraiserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Scores are 1 to 5, or not yet given while a draft.
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "appraisal_scores_range" CHECK (
  ("drivingScore" IS NULL OR "drivingScore" BETWEEN 1 AND 5) AND
  ("punctualityScore" IS NULL OR "punctualityScore" BETWEEN 1 AND 5) AND
  ("conductScore" IS NULL OR "conductScore" BETWEEN 1 AND 5) AND
  ("safetyScore" IS NULL OR "safetyScore" BETWEEN 1 AND 5) AND
  ("vehicleCareScore" IS NULL OR "vehicleCareScore" BETWEEN 1 AND 5) AND
  ("attendanceScore" IS NULL OR "attendanceScore" BETWEEN 1 AND 5)
);
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "appraisal_period_order" CHECK ("periodEnd" >= "periodStart");
-- A final appraisal has every score and the moment it was finalised; only a final one is acknowledged.
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "appraisal_final_complete" CHECK (
  "status" <> 'FINAL' OR (
    "finalisedAt" IS NOT NULL AND "drivingScore" IS NOT NULL AND "punctualityScore" IS NOT NULL AND
    "conductScore" IS NOT NULL AND "safetyScore" IS NOT NULL AND "vehicleCareScore" IS NOT NULL AND
    "attendanceScore" IS NOT NULL
  )
);
ALTER TABLE "driver_appraisals" ADD CONSTRAINT "appraisal_ack_after_final" CHECK ("acknowledgedAt" IS NULL OR "status" = 'FINAL');
