-- Creators on the public website: editors switch a creator on, and can hide one journey.
-- Nobody appears until an editor says so; every published journey of a shown creator does,
-- unless hidden. Nothing to backfill.

ALTER TABLE "creator_journeys" ADD COLUMN "onWebsite" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "creator_profiles" ADD COLUMN "showOnWebsite" BOOLEAN NOT NULL DEFAULT false;
