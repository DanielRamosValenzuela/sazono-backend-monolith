DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payments"
    WHERE "amount" < 0 OR "tip_amount" < 0 OR "tip_amount" > "amount"
  ) THEN
    RAISE EXCEPTION 'M4 precheck: existen pagos con monto negativo o propina inconsistente; corrigelos antes de migrar';
  END IF;
END
$$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_MANUAL_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundMethod" AS ENUM ('CASH_MANUAL', 'GATEWAY', 'MANUAL_EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_COMPLAINT', 'WRONG_ORDER', 'DISH_UNAVAILABLE', 'QUALITY_ISSUE', 'DUPLICATE_CHARGE', 'CASHIER_ERROR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'REFUND_OUT', 'TIP_PAYOUT', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "bills"
  ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "staff_users"
  ADD COLUMN IF NOT EXISTS "approval_pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "approval_pin_locked_until" TIMESTAMPTZ(3);

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "cashier_refund_limit" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "refund_tip_default" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_amount_range_check"
    CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_tip_range_check"
    CHECK ("refunded_tip_amount" >= 0 AND "refunded_tip_amount" <= "tip_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_consumption_range_check"
    CHECK (("refunded_amount" - "refunded_tip_amount") >= 0 AND ("refunded_amount" - "refunded_tip_amount") <= ("amount" - "tip_amount")) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_refunded_amount_check"
    CHECK ("refunded_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_cashier_refund_limit_check"
    CHECK ("cashier_refund_limit" IS NULL OR "cashier_refund_limit" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_amount_range_check";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_tip_range_check";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_consumption_range_check";
ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_refunded_amount_check";
ALTER TABLE "branch_settings" VALIDATE CONSTRAINT "branch_settings_cashier_refund_limit_check";

CREATE TABLE IF NOT EXISTS "refunds" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "method" "RefundMethod" NOT NULL,
    "reason_code" "RefundReason" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "provider" TEXT NOT NULL,
    "provider_refund_reference" TEXT,
    "provider_raw" JSONB,
    "failure_reason" TEXT,
    "requested_by_staff_user_id" UUID,
    "requested_by_role" "Role",
    "approved_by_staff_user_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "credit_note_status" TEXT NOT NULL DEFAULT 'PENDING',
    "credit_note_folio" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "refunds_tip_range_check" CHECK ("tip_amount" >= 0 AND "tip_amount" <= "amount"),
    CONSTRAINT "refunds_breakdown_check" CHECK ("net_amount" >= 0 AND "vat_amount" >= 0 AND "net_amount" + "vat_amount" = "amount" - "tip_amount"),
    CONSTRAINT "refunds_reason_text_check" CHECK (char_length(btrim("reason_text")) >= 3),
    CONSTRAINT "refunds_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 100),
    CONSTRAINT "refunds_completed_at_check" CHECK ("status" <> 'SUCCEEDED' OR "completed_at" IS NOT NULL),
    CONSTRAINT "refunds_source_check" CHECK ("source" IN ('STAFF', 'WEBHOOK', 'RECONCILIATION')),
    CONSTRAINT "refunds_credit_note_status_check" CHECK ("credit_note_status" IN ('PENDING', 'ISSUED', 'NOT_REQUIRED'))
);

CREATE TABLE IF NOT EXISTS "cash_movements" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "staff_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movements_amount_check" CHECK (
      ("type" = 'CASH_IN' AND "amount" > 0)
      OR ("type" IN ('CASH_OUT', 'REFUND_OUT', 'TIP_PAYOUT') AND "amount" < 0)
      OR ("type" = 'ADJUSTMENT' AND "amount" <> 0)
    ),
    CONSTRAINT "cash_movements_reason_check" CHECK (char_length(btrim("reason")) >= 3)
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID,
    "branch_id" UUID,
    "actor_staff_user_id" UUID,
    "actor_platform_admin_id" UUID,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "refunds_bill_id_idx" ON "refunds"("bill_id");
CREATE INDEX IF NOT EXISTS "refunds_payment_id_status_idx" ON "refunds"("payment_id", "status");
CREATE INDEX IF NOT EXISTS "refunds_branch_id_completed_at_idx" ON "refunds"("branch_id", "completed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_payment_id_idempotency_key_key" ON "refunds"("payment_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_provider_provider_refund_reference_key" ON "refunds"("provider", "provider_refund_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_movements_refund_id_key" ON "cash_movements"("refund_id");
CREATE INDEX IF NOT EXISTS "cash_movements_branch_id_created_at_idx" ON "cash_movements"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "cash_movements_payment_id_idx" ON "cash_movements"("payment_id");
CREATE INDEX IF NOT EXISTS "audit_logs_restaurant_id_created_at_idx" ON "audit_logs"("restaurant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_user_id_fkey" FOREIGN KEY ("requested_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_user_id_fkey" FOREIGN KEY ("approved_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION "audit_logs_immutable"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo insercion';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_logs_immutable_trg" ON "audit_logs";
CREATE TRIGGER "audit_logs_immutable_trg"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"();

DROP TRIGGER IF EXISTS "audit_logs_no_truncate_trg" ON "audit_logs";
CREATE TRIGGER "audit_logs_no_truncate_trg"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_immutable"();

CREATE OR REPLACE FUNCTION "cash_movements_immutable"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements es de solo insercion';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cash_movements_immutable_trg" ON "cash_movements";
CREATE TRIGGER "cash_movements_immutable_trg"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "cash_movements_immutable"();

DROP TRIGGER IF EXISTS "cash_movements_no_truncate_trg" ON "cash_movements";
CREATE TRIGGER "cash_movements_no_truncate_trg"
  BEFORE TRUNCATE ON "cash_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_movements_immutable"();

CREATE OR REPLACE FUNCTION "refunds_guard"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds no se puede borrar';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."tip_amount" IS DISTINCT FROM OLD."tip_amount"
    OR NEW."net_amount" IS DISTINCT FROM OLD."net_amount"
    OR NEW."vat_amount" IS DISTINCT FROM OLD."vat_amount"
    OR NEW."restaurant_id" IS DISTINCT FROM OLD."restaurant_id"
    OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
    OR NEW."bill_id" IS DISTINCT FROM OLD."bill_id"
    OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id" THEN
    RAISE EXCEPTION 'refunds: las columnas financieras son inmutables';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "refunds_guard_trg" ON "refunds";
CREATE TRIGGER "refunds_guard_trg"
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_guard"();
