-- The public website's database role: read-only, and only what the public may see.
--
-- Applied by `npm run db:site-role` (scripts/site-role.mjs), which also sets the role's
-- password from SITE_DB_PASSWORD. Safe to run again after every migration: grants are
-- repeated and policies replaced.
--
-- The API connects as the tables' owner, which row-level security does not bind (no
-- FORCE), so nothing here changes what the API can do.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'batoma_site') THEN
    CREATE ROLE batoma_site LOGIN NOINHERIT;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM batoma_site;
GRANT USAGE ON SCHEMA public TO batoma_site;

-- Columns, not whole tables: owners, verification notes and the like never reach the site.
GRANT SELECT (id, slug, title, subtitle, summary, "keyPoints", body, "coverImageUrl", "audioUrl", "readMinutes", language,
  status, "isSponsored", "isFeatured", "onWebsite", "categoryId", "issueId", "authorId", "sponsorBusinessId", "publishedAt", "updatedAt")
  ON articles TO batoma_site;
GRANT SELECT ON categories, article_destinations, destinations TO batoma_site;
GRANT SELECT (id, code, name, "nameNe", "startPlace", "endPlace", "distanceKm", "typicalHours", description) ON routes TO batoma_site;
GRANT SELECT (id, number, title, "titleNe", strapline, "coverImageUrl", season, status, "publishedAt") ON issues TO batoma_site;
GRANT SELECT (id, name, "avatarUrl") ON users TO batoma_site;
GRANT SELECT (id, slug, kind, "routeId", "destinationId", direction, title, summary, "coverImageUrl", "dayCount", status, "sortOrder", "publishedAt", "updatedAt")
  ON route_guides TO batoma_site;
GRANT SELECT (id, "guideId", kind, name, description, "imageUrl", latitude, longitude, "dayNumber", "distanceFromStartKm", "minutesFromStart",
  "priceFromNpr", "openingHours", "contactPhone", tip, "businessId", "isHighlight", "sortOrder")
  ON route_guide_stops TO batoma_site;
GRANT SELECT (id, slug, name, category, description, "destinationId", district, address, latitude, longitude, phone, whatsapp, viber,
  website, "priceRange", amenities, tier, "isActive", "verifiedAt", "updatedAt")
  ON businesses TO batoma_site;
GRANT SELECT (id, "businessId", url, caption, "sortOrder") ON business_photos TO batoma_site;
GRANT SELECT (id, "businessId", title, description, "discountLabel", "validFrom", "validTo", "isActive") ON coupons TO batoma_site;
GRANT SELECT (id, title, "advertiserName", tagline, "imageUrl", placement, "startsAt", "endsAt", "linkType", "externalUrl",
  "overviewTitle", "overviewBody", "overviewImageUrl", "businessId", "isActive", "targetCategoryId", "targetDestinationId")
  ON advertisements TO batoma_site;
GRANT SELECT ("appName", tagline, "themePalette") ON platform_settings TO batoma_site;
-- Events: everything a visitor reads, nothing about who added them.
GRANT SELECT (id, slug, title, "titleNe", summary, description, category, city, venue, address, "destinationId",
  "startsAt", "endsAt", "allDay", "priceLabel", organiser, url, "imageUrl", status, "isFeatured", "publishedAt", "updatedAt")
  ON events TO batoma_site;
-- The only thing the site writes: its own page views, impressions and /go/ clicks.
GRANT INSERT ON site_events TO batoma_site;
GRANT USAGE ON SEQUENCE site_events_id_seq TO batoma_site;

-- Rows: only what is published, verified and live.
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON articles;
-- An editor can keep a published story in the app and take it off the website (onWebsite).
CREATE POLICY site_read ON articles FOR SELECT TO batoma_site USING (status = 'PUBLISHED' AND "onWebsite");

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON issues;
CREATE POLICY site_read ON issues FOR SELECT TO batoma_site USING (status = 'PUBLISHED');

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON users;
-- Bylines only: the authors of published articles.
CREATE POLICY site_read ON users FOR SELECT TO batoma_site
  USING (id IN (SELECT "authorId" FROM articles WHERE status = 'PUBLISHED' AND "authorId" IS NOT NULL));

ALTER TABLE route_guides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON route_guides;
CREATE POLICY site_read ON route_guides FOR SELECT TO batoma_site USING (status = 'PUBLISHED');

ALTER TABLE route_guide_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON route_guide_stops;
CREATE POLICY site_read ON route_guide_stops FOR SELECT TO batoma_site
  USING ("guideId" IN (SELECT id FROM route_guides WHERE status = 'PUBLISHED'));

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON businesses;
-- Verification is manual: an unverified listing is never shown off on the website.
CREATE POLICY site_read ON businesses FOR SELECT TO batoma_site USING ("isActive" AND "verifiedAt" IS NOT NULL);

ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON business_photos;
CREATE POLICY site_read ON business_photos FOR SELECT TO batoma_site
  USING ("businessId" IN (SELECT id FROM businesses WHERE "isActive" AND "verifiedAt" IS NOT NULL));

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON coupons;
CREATE POLICY site_read ON coupons FOR SELECT TO batoma_site
  USING ("isActive" AND "validTo" > now() AND "businessId" IN (SELECT id FROM businesses WHERE "isActive" AND "verifiedAt" IS NOT NULL));

ALTER TABLE advertisements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON advertisements;
CREATE POLICY site_read ON advertisements FOR SELECT TO batoma_site USING ("isActive" AND placement::text LIKE 'WEB\_%');

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_read ON events;
-- Drafts stay in the control panel; a cancelled event stays listed, marked cancelled.
CREATE POLICY site_read ON events FOR SELECT TO batoma_site USING (status IN ('PUBLISHED', 'CANCELLED'));

ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS site_write ON site_events;
CREATE POLICY site_write ON site_events FOR INSERT TO batoma_site WITH CHECK (true);
