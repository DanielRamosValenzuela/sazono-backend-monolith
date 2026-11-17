ALTER TABLE "menu_categories" ADD COLUMN "parent_id" UUID;

ALTER TABLE "order_items" ADD COLUMN "category_path_snapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "menu_category_id" UUID;

CREATE INDEX "menu_categories_menu_id_parent_id_sort_order_idx" ON "menu_categories"("menu_id", "parent_id", "sort_order");

ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "order_items" oi
SET "menu_category_id" = mi."menu_category_id"
FROM "menu_items" mi
WHERE mi."id" = oi."menu_item_id"
  AND oi."menu_category_id" IS NULL;

UPDATE "order_items" oi
SET "category_path_snapshot" = ARRAY[mc."name"]
FROM "menu_items" mi
JOIN "menu_categories" mc ON mc."id" = mi."menu_category_id"
WHERE mi."id" = oi."menu_item_id"
  AND (oi."category_path_snapshot" IS NULL OR cardinality(oi."category_path_snapshot") = 0);

UPDATE "order_items"
SET "category_path_snapshot" = ARRAY['(Sin categoria)']
WHERE "category_path_snapshot" IS NULL OR cardinality("category_path_snapshot") = 0;
