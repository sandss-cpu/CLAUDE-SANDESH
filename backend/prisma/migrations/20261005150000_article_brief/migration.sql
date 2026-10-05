-- Briefer articles (Feature 4): a one-line summary for cards and up to three key points
-- for the "In brief" box. Publishing new articles requires both (checked in the API).

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "summary" VARCHAR(160);


ALTER TABLE "articles" ADD CONSTRAINT "article_key_points" CHECK (
  coalesce(array_length("keyPoints", 1), 0) <= 3
);

-- Backfill: each article's first sentence, from its body with headings and markdown emphasis
-- removed. Sentences end in . ! ? or the Devanagari danda. Without one inside 160 characters,
-- the opening is cut at a word and given an ellipsis; with no body, the standfirst is used.
WITH clean AS (
  SELECT id, subtitle,
    trim(regexp_replace(
      regexp_replace(regexp_replace(body, '^#+[^\n]*$', '', 'gn'), '(\*\*|__|\*|_|`)', '', 'g'),
      '\s+', ' ', 'g')) AS t
  FROM "articles"
  WHERE "summary" IS NULL
)
UPDATE "articles" a SET "summary" = CASE
    WHEN c.t ~ '^.{10,159}?[.!?।](\s|$)' THEN substring(c.t from '^(.{10,159}?[.!?।])(?:\s|$)')
    WHEN length(c.t) > 0 THEN rtrim(substring(c.t from '^(.{1,150})(?:\s|$)')) || '…'
    ELSE left(coalesce(c.subtitle, ''), 160)
  END
FROM clean c
WHERE a.id = c.id;
UPDATE "articles" SET "summary" = NULL WHERE "summary" = '' OR "summary" = '…';
