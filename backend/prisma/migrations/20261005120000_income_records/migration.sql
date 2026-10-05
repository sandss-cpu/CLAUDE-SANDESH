-- Daily income and ticket records (Feature 6).
--
-- Nothing to backfill: every company starts with finance off, and the default income
-- sources are created when an owner turns it on. Money is integer paisa throughout.

-- CreateEnum
CREATE TYPE "IncomeSourceKind" AS ENUM ('CASH', 'PORTAL', 'CARGO', 'HIRE', 'OTHER');

-- AlterTable
ALTER TABLE "operators" ADD COLUMN     "financeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "financeEnabledAt" TIMESTAMP(3),
ADD COLUMN     "managersSeeTotals" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "income_sources" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "IncomeSourceKind" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "importMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_entries" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "tripId" TEXT,
    "date" DATE NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ticketsSold" INTEGER NOT NULL DEFAULT 0,
    "seatsSold" INTEGER,
    "grossPaisa" INTEGER NOT NULL,
    "feesPaisa" INTEGER NOT NULL DEFAULT 0,
    "netPaisa" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "attachmentKey" TEXT,
    "importId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_imports" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "invalid" INTEGER NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdById" TEXT,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "income_sources_operatorId_name_key" ON "income_sources"("operatorId", "name");

-- CreateIndex
CREATE INDEX "income_entries_operatorId_date_idx" ON "income_entries"("operatorId", "date");

-- CreateIndex
CREATE INDEX "income_entries_vehicleId_date_idx" ON "income_entries"("vehicleId", "date");

-- CreateIndex
CREATE INDEX "income_entries_importId_idx" ON "income_entries"("importId");

-- CreateIndex
CREATE INDEX "income_imports_operatorId_createdAt_idx" ON "income_imports"("operatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "income_sources" ADD CONSTRAINT "income_sources_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "income_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_entries" ADD CONSTRAINT "income_entries_importId_fkey" FOREIGN KEY ("importId") REFERENCES "income_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_imports" ADD CONSTRAINT "income_imports_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_imports" ADD CONSTRAINT "income_imports_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "income_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The same portal settlement cannot be entered twice for one source, among live entries:
-- partial, so an undone (soft-deleted) import can be imported again. Prisma cannot express
-- a partial index, so it lives here only.
CREATE UNIQUE INDEX "income_entry_source_reference" ON "income_entries" ("sourceId", "reference")
  WHERE "deletedAt" IS NULL AND "reference" IS NOT NULL;

ALTER TABLE "income_entries" ADD CONSTRAINT "income_amounts_valid" CHECK (
  "grossPaisa" >= 0 AND "feesPaisa" >= 0 AND "feesPaisa" <= "grossPaisa"
  AND "netPaisa" = "grossPaisa" - "feesPaisa"
  AND "ticketsSold" >= 0 AND ("seatsSold" IS NULL OR "seatsSold" >= 0)
);
ALTER TABLE "income_entries" ADD CONSTRAINT "income_reference_not_blank" CHECK ("reference" IS NULL OR length(trim("reference")) > 0);
ALTER TABLE "income_imports" ADD CONSTRAINT "income_import_counts" CHECK (
  "rows" >= 0 AND "created" >= 0 AND "duplicates" >= 0 AND "invalid" >= 0
);
