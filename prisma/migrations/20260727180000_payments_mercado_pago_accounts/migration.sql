CREATE TYPE "PaymentGatewayProvider" AS ENUM ('MERCADO_PAGO');

CREATE TYPE "PaymentAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "restaurant_payment_accounts" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'PENDING',
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "external_account_id" TEXT,
    "public_key" TEXT,
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "live_mode" BOOLEAN NOT NULL DEFAULT false,
    "application_fee_bps" INTEGER,
    "connected_at" TIMESTAMPTZ(3),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurant_payment_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_oauth_states" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "created_by_staff_user_id" UUID NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "code_verifier" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "process_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_attempts" ADD COLUMN "restaurant_payment_account_id" UUID;
ALTER TABLE "payment_attempts" ADD COLUMN "provider_status" TEXT;
ALTER TABLE "payment_attempts" ADD COLUMN "provider_status_detail" TEXT;

ALTER TABLE "payments" ADD COLUMN "payment_attempt_id" UUID;

CREATE UNIQUE INDEX "restaurant_payment_accounts_restaurant_id_provider_key" ON "restaurant_payment_accounts"("restaurant_id", "provider");

CREATE UNIQUE INDEX "payment_oauth_states_state_key" ON "payment_oauth_states"("state");

CREATE INDEX "payment_oauth_states_expires_at_idx" ON "payment_oauth_states"("expires_at");

CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

CREATE INDEX "payment_webhook_events_provider_resource_id_idx" ON "payment_webhook_events"("provider", "resource_id");

CREATE INDEX "payment_attempts_provider_provider_reference_idx" ON "payment_attempts"("provider", "provider_reference");

CREATE UNIQUE INDEX "payments_payment_attempt_id_key" ON "payments"("payment_attempt_id");

CREATE UNIQUE INDEX "payments_provider_provider_reference_key" ON "payments"("provider", "provider_reference");

ALTER TABLE "restaurant_payment_accounts" ADD CONSTRAINT "restaurant_payment_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_oauth_states" ADD CONSTRAINT "payment_oauth_states_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_oauth_states" ADD CONSTRAINT "payment_oauth_states_created_by_staff_user_id_fkey" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_restaurant_payment_account_id_fkey" FOREIGN KEY ("restaurant_payment_account_id") REFERENCES "restaurant_payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."_prisma_migrations" DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',
      r.tablename
    );
  END LOOP;
END
$$;
