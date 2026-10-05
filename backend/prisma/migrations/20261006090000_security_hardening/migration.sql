-- Step 10: security hardening. Recovery codes, sign-in lockout, known devices, "sign out
-- everywhere", verification documents, the 13-month aggregates, and the blind index for
-- company contact phones. Encrypting existing values needs the keys, so it is a script,
-- not SQL: run `npm run fields:encrypt` after this migration (DECISIONS.md, step 10).

-- CreateEnum
CREATE TYPE "VerificationDocKind" AS ENUM ('PAN', 'COMPANY_REGISTRATION', 'BLUEBOOK', 'ROUTE_PERMIT', 'BUSINESS_LICENCE', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "sessionsValidFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_guards" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "login_guards_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "businessId" TEXT,
    "kind" "VerificationDocKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_daily" (
    "day" DATE NOT NULL,
    "qrCodeId" TEXT NOT NULL,
    "scans" INTEGER NOT NULL,
    "firstScans" INTEGER NOT NULL,
    "sessions" INTEGER NOT NULL,

    CONSTRAINT "scan_daily_pkey" PRIMARY KEY ("day","qrCodeId")
);

-- CreateTable
CREATE TABLE "site_event_daily" (
    "id" BIGSERIAL NOT NULL,
    "day" DATE NOT NULL,
    "type" "SiteEventType" NOT NULL,
    "target" TEXT,
    "businessId" TEXT,
    "adId" TEXT,
    "articleId" TEXT,
    "count" INTEGER NOT NULL,

    CONSTRAINT "site_event_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_codeHash_key" ON "recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_userId_deviceHash_key" ON "known_devices"("userId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "verification_documents_storageKey_key" ON "verification_documents"("storageKey");

-- CreateIndex
CREATE INDEX "verification_documents_operatorId_idx" ON "verification_documents"("operatorId");

-- CreateIndex
CREATE INDEX "verification_documents_businessId_idx" ON "verification_documents"("businessId");

-- CreateIndex
CREATE INDEX "site_event_daily_businessId_day_idx" ON "site_event_daily"("businessId", "day");

-- CreateIndex
CREATE INDEX "site_event_daily_adId_day_idx" ON "site_event_daily"("adId", "day");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Company contact phones are encrypted; this keyed hash is how they are searched.
ALTER TABLE "operators" ADD COLUMN "contactPhoneIdx" TEXT;
CREATE INDEX "operators_contactPhoneIdx_idx" ON "operators"("contactPhoneIdx");

-- A document belongs to exactly one company or one business.
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_one_owner"
  CHECK (("operatorId" IS NULL) <> ("businessId" IS NULL));

-- Aggregates are written once per day and target; a re-run of the job adds nothing.
CREATE UNIQUE INDEX "site_event_daily_once" ON "site_event_daily"
  ("day", "type", COALESCE("target", ''), COALESCE("businessId", ''), COALESCE("adId", ''), COALESCE("articleId", ''));
