ALTER TABLE "modifier_groups"
  ADD COLUMN IF NOT EXISTS "parent_option_id" UUID;

CREATE INDEX IF NOT EXISTS "modifier_groups_parent_option_id_idx"
  ON "modifier_groups"("parent_option_id");

DO $$ BEGIN
  ALTER TABLE "modifier_groups"
    ADD CONSTRAINT "modifier_groups_parent_option_id_fkey"
    FOREIGN KEY ("parent_option_id") REFERENCES "modifier_options"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "order_item_modifiers"
  ADD COLUMN IF NOT EXISTS "parent_order_item_modifier_id" UUID,
  ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "path_snapshot" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "order_item_modifiers_parent_order_item_modifier_id_idx"
  ON "order_item_modifiers"("parent_order_item_modifier_id");

DO $$ BEGIN
  ALTER TABLE "order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_parent_order_item_modifier_id_fkey"
    FOREIGN KEY ("parent_order_item_modifier_id") REFERENCES "order_item_modifiers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_depth_check"
    CHECK ("depth" BETWEEN 1 AND 3) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "order_item_modifiers" VALIDATE CONSTRAINT "order_item_modifiers_depth_check";

UPDATE "order_item_modifiers"
  SET "path_snapshot" = ARRAY["name_snapshot"]
  WHERE "path_snapshot" IS NULL OR cardinality("path_snapshot") = 0;
