DO $$ BEGIN
  CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "require_open_cash_session" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "cash_sessions" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_label" TEXT NOT NULL DEFAULT 'Caja 1',
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "cashier_staff_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float" DECIMAL(12,2) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_staff_user_id" UUID,
    "expected_cash" DECIMAL(12,2),
    "cash_sales_amount" DECIMAL(12,2),
    "movements_amount" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "closing_note" TEXT,
    "denominations" JSONB,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_sessions_opening_float_check" CHECK ("opening_float" >= 0),
    CONSTRAINT "cash_sessions_label_check" CHECK (char_length("register_label") BETWEEN 1 AND 40 AND "register_label" = btrim("register_label")),
    CONSTRAINT "cash_sessions_state_check" CHECK (
      ("status" = 'OPEN'
        AND "closed_at" IS NULL AND "closed_by_staff_user_id" IS NULL
        AND "expected_cash" IS NULL AND "counted_cash" IS NULL AND "difference" IS NULL)
      OR ("status" = 'CLOSED'
        AND "closed_at" IS NOT NULL AND "closed_by_staff_user_id" IS NOT NULL
        AND "expected_cash" IS NOT NULL AND "counted_cash" IS NOT NULL AND "difference" IS NOT NULL
        AND "counted_cash" >= 0 AND "difference" = "counted_cash" - "expected_cash")
    ),
    CONSTRAINT "cash_sessions_difference_note_check" CHECK (
      "difference" IS NULL OR "difference" = 0 OR char_length(btrim("closing_note")) >= 3
    )
);

CREATE INDEX IF NOT EXISTS "cash_sessions_branch_id_opened_at_idx" ON "cash_sessions"("branch_id", "opened_at");
CREATE INDEX IF NOT EXISTS "cash_sessions_cashier_staff_user_id_status_idx" ON "cash_sessions"("cashier_staff_user_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_register_idx"
  ON "cash_sessions"("branch_id", lower("register_label"))
  WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_cashier_idx"
  ON "cash_sessions"("branch_id", "cashier_staff_user_id")
  WHERE "status" = 'OPEN';

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cashier_staff_user_id_fkey" FOREIGN KEY ("cashier_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_staff_user_id_fkey" FOREIGN KEY ("closed_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "cash_session_id" UUID;

ALTER TABLE "cash_movements"
  ADD COLUMN IF NOT EXISTS "cash_session_id" UUID,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_idempotency_key_check"
    CHECK ("idempotency_key" IS NULL OR char_length("idempotency_key") BETWEEN 8 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "payments_cash_session_id_idx" ON "payments"("cash_session_id");
CREATE INDEX IF NOT EXISTS "cash_movements_cash_session_id_idx" ON "cash_movements"("cash_session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_movements_branch_id_staff_user_id_idempotency_key_key"
  ON "cash_movements"("branch_id", "staff_user_id", "idempotency_key");

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
