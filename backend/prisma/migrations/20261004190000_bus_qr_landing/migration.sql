-- One QR per bus, magazine first (Phase 3, Feature 2).
--
-- Every active bus gets its permanent BUS code here if it has none, the database keeps it
-- to one active BUS code per bus, and prints and downloads of stickers are recorded.

-- CreateTable
CREATE TABLE "qr_prints" (
    "id" TEXT NOT NULL,
    "qrCodeId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "printedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qr_prints_qrCodeId_createdAt_idx" ON "qr_prints"("qrCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "qr_prints_operatorId_createdAt_idx" ON "qr_prints"("operatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "qr_prints" ADD CONSTRAINT "qr_prints_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "qr_prints" ADD CONSTRAINT "qr_print_format" CHECK ("format" IN ('PDF_A6', 'PDF_SEAT', 'SHEET_A6', 'PNG', 'SVG'));

-- Backfill: a BUS code for every active bus without one, in the sticker alphabet
-- (no 0, O, 1 or I: codes get read off a sticker in a moving vehicle). A clash with an
-- existing code just draws again.
DO $$
DECLARE
  bus record;
  code text;
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
BEGIN
  FOR bus IN
    SELECT v."id", v."operatorId", v."routeId" FROM "vehicles" v
     WHERE v."isActive"
       AND NOT EXISTS (SELECT 1 FROM "qr_codes" q WHERE q."vehicleId" = v."id" AND q."kind" = 'BUS' AND q."isActive")
  LOOP
    LOOP
      code := (SELECT string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') FROM generate_series(1, 10));
      BEGIN
        INSERT INTO "qr_codes" ("id", "shortCode", "operatorId", "vehicleId", "routeId", "kind", "placement", "isActive", "createdAt")
        VALUES (gen_random_uuid()::text, code, bus."operatorId", bus."id", bus."routeId", 'BUS', 'BUS_PROFILE', true,
                CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- drew a code that exists already; draw again
      END;
    END LOOP;
  END LOOP;
END $$;

-- A bus has one active BUS code. Replacing a sticker switches the old one off first.
CREATE UNIQUE INDEX "qr_one_active_bus_code" ON "qr_codes" ("vehicleId") WHERE "kind" = 'BUS' AND "isActive";
