-- Website visibility for articles, separate from publishing: a published story can stay in
-- the app and come off the public website. Every existing article stays where it is.
-- Re-run `npm run db:site-role` afterwards: the site role's policy reads this column.
ALTER TABLE "articles" ADD COLUMN "onWebsite" BOOLEAN NOT NULL DEFAULT true;
