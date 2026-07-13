ALTER TABLE "restaurants" ADD COLUMN "slug" TEXT;
ALTER TABLE "restaurants" ADD COLUMN "branch_quota" INTEGER NOT NULL DEFAULT 1;

UPDATE "restaurants"
SET "slug" = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substring(id::text, 1, 8)
WHERE "slug" IS NULL;

ALTER TABLE "restaurants" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_slug_key" UNIQUE ("slug");
