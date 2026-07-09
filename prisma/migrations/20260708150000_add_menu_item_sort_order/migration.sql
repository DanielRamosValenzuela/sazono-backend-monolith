-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "menu_items_menu_category_id_sort_order_idx" ON "menu_items"("menu_category_id", "sort_order");
