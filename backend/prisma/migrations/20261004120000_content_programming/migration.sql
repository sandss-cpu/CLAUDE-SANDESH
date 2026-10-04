-- Route-aware content programming (Phase 3, Feature 1).
--
-- article_routes was a flat link: no direction, no schedule, no company or bus
-- override and no lead story. content_placements replaces it; every existing link
-- becomes a ROUTE placement for both directions, in its old order, before the old
-- table is dropped.

CREATE TYPE "PlacementScope" AS ENUM ('DEFAULT', 'ROUTE', 'OPERATOR', 'VEHICLE');
CREATE TYPE "NoticeSeverity" AS ENUM ('INFO', 'WARNING', 'DANGER');

CREATE TABLE "content_placements" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "scope" "PlacementScope" NOT NULL,
    "routeId" TEXT,
    "operatorId" TEXT,
    "vehicleId" TEXT,
    "direction" "GuideDirection" NOT NULL DEFAULT 'BOTH',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_placements_pkey" PRIMARY KEY ("id"),
    -- Which target columns a scope uses. DEFAULT reaches every bus in both directions.
    CONSTRAINT "placement_target" CHECK (
        ("scope" = 'DEFAULT'  AND "routeId" IS NULL AND "operatorId" IS NULL AND "vehicleId" IS NULL AND "direction" = 'BOTH')
     OR ("scope" = 'ROUTE'    AND "routeId" IS NOT NULL AND "operatorId" IS NULL AND "vehicleId" IS NULL)
     OR ("scope" = 'OPERATOR' AND "operatorId" IS NOT NULL AND "vehicleId" IS NULL)
     OR ("scope" = 'VEHICLE'  AND "vehicleId" IS NOT NULL AND "operatorId" IS NULL)
    ),
    CONSTRAINT "placement_window" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "placement_days" CHECK ("daysOfWeek" <@ ARRAY[0,1,2,3,4,5,6]),
    CONSTRAINT "placement_hours" CHECK (
        ("timeFrom" IS NULL AND "timeTo" IS NULL)
     OR ("timeFrom" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "timeTo" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "timeFrom" <> "timeTo")
    )
);

-- One article sits in a slot once; a second schedule for it is an edit, not a copy.
CREATE UNIQUE INDEX "placement_slot" ON "content_placements" (
    "articleId", "scope", COALESCE("routeId", ''), COALESCE("operatorId", ''), COALESCE("vehicleId", ''), "direction"
);
CREATE INDEX "content_placements_scope_routeId_direction_idx" ON "content_placements"("scope", "routeId", "direction");
CREATE INDEX "content_placements_operatorId_idx" ON "content_placements"("operatorId");
CREATE INDEX "content_placements_vehicleId_idx" ON "content_placements"("vehicleId");
CREATE INDEX "content_placements_articleId_idx" ON "content_placements"("articleId");

ALTER TABLE "content_placements" ADD CONSTRAINT "content_placements_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_placements" ADD CONSTRAINT "content_placements_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_placements" ADD CONSTRAINT "content_placements_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_placements" ADD CONSTRAINT "content_placements_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_placements" ADD CONSTRAINT "content_placements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every corridor link becomes a ROUTE placement for both directions.
-- Timestamps in UTC explicitly, as Prisma writes them: CURRENT_TIMESTAMP into a
-- "timestamp without time zone" column takes the server's zone, and a server set to
-- Asia/Kathmandu stamped these rows 5h45 in the future.
INSERT INTO "content_placements" ("id", "articleId", "scope", "routeId", "direction", "position", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "articleId", 'ROUTE', "routeId", 'BOTH', "sortOrder",
       CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  FROM "article_routes";

DROP TABLE "article_routes";

CREATE TABLE "route_notices" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "direction" "GuideDirection" NOT NULL DEFAULT 'BOTH',
    "severity" "NoticeSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "titleNe" TEXT,
    "body" TEXT,
    "bodyNe" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_notices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "route_notice_window" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);
CREATE INDEX "route_notices_routeId_startsAt_idx" ON "route_notices"("routeId", "startsAt");
ALTER TABLE "route_notices" ADD CONSTRAINT "route_notices_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "routeId" TEXT,
    "operatorId" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_events_entityType_entityId_createdAt_idx" ON "audit_events"("entityType", "entityId", "createdAt");
CREATE INDEX "audit_events_routeId_createdAt_idx" ON "audit_events"("routeId", "createdAt");
CREATE INDEX "audit_events_operatorId_createdAt_idx" ON "audit_events"("operatorId", "createdAt");
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt");
CREATE INDEX "audit_events_action_createdAt_idx" ON "audit_events"("action", "createdAt");
