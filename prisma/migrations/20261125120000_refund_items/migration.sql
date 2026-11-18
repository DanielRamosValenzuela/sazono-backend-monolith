ALTER TABLE "bill_items"
  ADD COLUMN IF NOT EXISTS "refunded_quantity" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_refunded_quantity_check"
    CHECK ("refunded_quantity" >= 0 AND "refunded_quantity" <= "quantity") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bill_items" VALIDATE CONSTRAINT "bill_items_refunded_quantity_check";

CREATE TABLE IF NOT EXISTS "refund_items" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "bill_item_id" UUID NOT NULL,
    "order_item_id" UUID,
    "menu_item_id" UUID,
    "preparation_station_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "category_path_snapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kitchen_waste" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "refund_items_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "refund_items_refund_id_bill_item_id_key" ON "refund_items"("refund_id", "bill_item_id");
CREATE INDEX IF NOT EXISTS "refund_items_bill_item_id_idx" ON "refund_items"("bill_item_id");
CREATE INDEX IF NOT EXISTS "refund_items_kitchen_waste_created_at_idx" ON "refund_items"("kitchen_waste", "created_at");

DO $$ BEGIN
  ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "refund_items" ENABLE ROW LEVEL SECURITY;
