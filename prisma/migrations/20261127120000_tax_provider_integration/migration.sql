DO $$ BEGIN
  CREATE TYPE "TaxProvider" AS ENUM ('OPENFACTURA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaxProviderEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaxProviderAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "economic_activity_code" INTEGER,
  ADD COLUMN IF NOT EXISTS "legal_commune" TEXT,
  ADD COLUMN IF NOT EXISTS "legal_city" TEXT;

CREATE TABLE IF NOT EXISTS "restaurant_tax_provider_accounts" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "provider" "TaxProvider" NOT NULL,
  "environment" "TaxProviderEnvironment" NOT NULL,
  "status" "TaxProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "api_key_cipher" TEXT NOT NULL,
  "last_verified_at" TIMESTAMPTZ(3),
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurant_tax_provider_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "restaurant_tax_provider_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_tax_provider_accounts_restaurant_id_provider_env_key"
  ON "restaurant_tax_provider_accounts" ("restaurant_id", "provider", "environment");

ALTER TABLE "restaurant_tax_provider_accounts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "tax_documents"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "last_error" TEXT,
  ADD COLUMN IF NOT EXISTS "request_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_status" TEXT,
  ADD COLUMN IF NOT EXISTS "xml_url" TEXT;

DROP INDEX IF EXISTS "tax_documents_branch_id_type_folio_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tax_documents_restaurant_id_type_folio_key"
  ON "tax_documents" ("restaurant_id", "type", "folio");

CREATE UNIQUE INDEX IF NOT EXISTS "tax_documents_restaurant_id_idempotency_key_key"
  ON "tax_documents" ("restaurant_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "tax_documents_status_next_attempt_at_idx"
  ON "tax_documents" ("status", "next_attempt_at");

CREATE UNIQUE INDEX IF NOT EXISTS "tax_documents_one_active_boleta_per_bill"
  ON "tax_documents" ("bill_id")
  WHERE "type" IN ('BOLETA_AFECTA', 'BOLETA_EXENTA') AND "status" NOT IN ('VOIDED', 'REJECTED');
