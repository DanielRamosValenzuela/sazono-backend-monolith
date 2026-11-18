ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "platform_fee_bps" INTEGER NOT NULL DEFAULT 100;

DO $$ BEGIN
  CREATE TYPE "PlatformFeeStatementStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'WAIVED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "platform_fee_statements" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "period_month" DATE NOT NULL,
  "gross_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tips_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refunds_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "carry_over_in" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "net_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "fee_bps" INTEGER NOT NULL,
  "fee_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
  "status" "PlatformFeeStatementStatus" NOT NULL DEFAULT 'DRAFT',
  "breakdown" JSONB,
  "notes" TEXT,
  "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_at" TIMESTAMPTZ(3),
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_fee_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_fee_statements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_fee_statements_fee_bps_check" CHECK ("fee_bps" >= 0 AND "fee_bps" <= 10000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_fee_statements_restaurant_id_period_month_key"
  ON "platform_fee_statements" ("restaurant_id", "period_month");
CREATE INDEX IF NOT EXISTS "platform_fee_statements_period_month_status_idx"
  ON "platform_fee_statements" ("period_month", "status");

ALTER TABLE "platform_fee_statements" ENABLE ROW LEVEL SECURITY;

UPDATE "restaurant_payment_accounts" SET "application_fee_bps" = 0 WHERE "application_fee_bps" > 0;
