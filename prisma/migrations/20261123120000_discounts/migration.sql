DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bills"
    WHERE "total_amount" <> "subtotal_amount" + "tip_amount" + "tax_amount"
  ) THEN
    RAISE EXCEPTION 'M8a precheck: existen cuentas con total distinto de subtotal + propina + impuesto; corrigelas antes de migrar';
  END IF;
END
$$;

DO $$ BEGIN
  CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountReason" AS ENUM ('COURTESY', 'CUSTOMER_COMPLAINT', 'STAFF_MEAL', 'PROMOTION', 'LOYALTY', 'PRICE_ERROR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bills"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "bill_items"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "discount_approval_percent" DECIMAL(5,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "discount_approval_amount" DECIMAL(12,2);

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_discount_amount_range_check"
    CHECK ("discount_amount" >= 0 AND "discount_amount" <= "subtotal_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_total_formula_check"
    CHECK ("total_amount" = "subtotal_amount" - "discount_amount" + "tip_amount" + "tax_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_discount_amount_range_check"
    CHECK ("discount_amount" >= 0 AND "discount_amount" <= "total_price") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_discount_approval_check"
    CHECK (
      ("discount_approval_percent" IS NULL OR ("discount_approval_percent" >= 0 AND "discount_approval_percent" <= 100))
      AND ("discount_approval_amount" IS NULL OR "discount_approval_amount" >= 0)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_discount_amount_range_check";
ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_total_formula_check";
ALTER TABLE "bill_items" VALIDATE CONSTRAINT "bill_items_discount_amount_range_check";
ALTER TABLE "branch_settings" VALIDATE CONSTRAINT "branch_settings_discount_approval_check";

CREATE TABLE IF NOT EXISTS "bill_discounts" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_item_id" UUID,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason_code" "DiscountReason" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "applied_by_staff_user_id" UUID NOT NULL,
    "applied_by_role" "Role" NOT NULL,
    "approved_by_staff_user_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_staff_user_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_discounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_discounts_value_check" CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 100)),
    CONSTRAINT "bill_discounts_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "bill_discounts_reason_text_check" CHECK (char_length(btrim("reason_text")) >= 3),
    CONSTRAINT "bill_discounts_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 100),
    CONSTRAINT "bill_discounts_void_check" CHECK (
      ("voided_at" IS NULL AND "voided_by_staff_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_staff_user_id" IS NOT NULL AND char_length(btrim("void_reason")) >= 3)
    )
);

CREATE INDEX IF NOT EXISTS "bill_discounts_bill_id_idx" ON "bill_discounts"("bill_id");
CREATE INDEX IF NOT EXISTS "bill_discounts_bill_item_id_idx" ON "bill_discounts"("bill_item_id");
CREATE INDEX IF NOT EXISTS "bill_discounts_branch_id_created_at_idx" ON "bill_discounts"("branch_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_bill_id_idempotency_key_key" ON "bill_discounts"("bill_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_one_active_per_bill_idx"
  ON "bill_discounts"("bill_id")
  WHERE "bill_item_id" IS NULL AND "voided_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_one_active_per_item_idx"
  ON "bill_discounts"("bill_item_id")
  WHERE "bill_item_id" IS NOT NULL AND "voided_at" IS NULL;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_applied_by_staff_user_id_fkey" FOREIGN KEY ("applied_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_approved_by_staff_user_id_fkey" FOREIGN KEY ("approved_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_voided_by_staff_user_id_fkey" FOREIGN KEY ("voided_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bill_discounts" ENABLE ROW LEVEL SECURITY;
