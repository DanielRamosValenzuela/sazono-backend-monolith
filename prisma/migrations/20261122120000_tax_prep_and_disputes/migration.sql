ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "tax_id" TEXT,
  ADD COLUMN IF NOT EXISTS "business_activity" TEXT,
  ADD COLUMN IF NOT EXISTS "legal_address" TEXT;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "disputed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "bill_sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "bills"
  ADD COLUMN IF NOT EXISTS "number" INTEGER;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "branch_id" ORDER BY "created_at", "id") AS rn
  FROM "bills"
  WHERE "number" IS NULL
)
UPDATE "bills" b SET "number" = n.rn
FROM numbered n
WHERE b."id" = n."id"
  AND NOT EXISTS (SELECT 1 FROM "bills" x WHERE x."branch_id" = b."branch_id" AND x."number" IS NOT NULL);

UPDATE "branches" br SET "bill_sequence" = COALESCE(
  (SELECT MAX("number") FROM "bills" WHERE "branch_id" = br."id"), 0
)
WHERE br."bill_sequence" = 0;

CREATE UNIQUE INDEX IF NOT EXISTS "bills_branch_id_number_key" ON "bills" ("branch_id", "number");

DO $$ BEGIN
  CREATE TYPE "TaxDocumentType" AS ENUM ('BOLETA_AFECTA', 'BOLETA_EXENTA', 'NOTA_CREDITO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TaxDocumentStatus" AS ENUM ('PENDING', 'ISSUED', 'REJECTED', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "tax_documents" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "bill_id" UUID NOT NULL,
  "payment_id" UUID,
  "refund_id" UUID,
  "type" "TaxDocumentType" NOT NULL,
  "status" "TaxDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "folio" INTEGER,
  "issued_at" TIMESTAMPTZ(3),
  "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "exempt_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "reference_document_id" UUID,
  "reference_code" INTEGER,
  "reason" TEXT,
  "provider" TEXT,
  "provider_doc_id" TEXT,
  "pdf_url" TEXT,
  "timbre" TEXT,
  "sii_track_id" TEXT,
  "receiver_rut" TEXT,
  "receiver_name" TEXT,
  "raw_response" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_documents_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_documents_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_documents_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_documents_reference_document_id_fkey" FOREIGN KEY ("reference_document_id") REFERENCES "tax_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tax_documents_refund_id_key" ON "tax_documents" ("refund_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tax_documents_branch_id_type_folio_key" ON "tax_documents" ("branch_id", "type", "folio");
CREATE INDEX IF NOT EXISTS "tax_documents_bill_id_idx" ON "tax_documents" ("bill_id");
CREATE INDEX IF NOT EXISTS "tax_documents_restaurant_id_issued_at_idx" ON "tax_documents" ("restaurant_id", "issued_at");

ALTER TABLE "tax_documents" ENABLE ROW LEVEL SECURITY;
