CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'MERCADO_PAGO', 'VOUCHER', 'MACH', 'OTHER');

ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod";
ALTER TABLE "payments" ADD COLUMN "staff_user_id" UUID;
ALTER TABLE "payments" ADD COLUMN "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "payments" ADD COLUMN "source" TEXT;
ALTER TABLE "payments" ADD COLUMN "gateway_meta" JSONB;

CREATE INDEX "payments_paid_at_status_idx" ON "payments"("paid_at", "status");
CREATE INDEX "payments_staff_user_id_paid_at_idx" ON "payments"("staff_user_id", "paid_at");
CREATE INDEX "bills_branch_id_closed_at_idx" ON "bills"("branch_id", "closed_at");

ALTER TABLE "payments" ADD CONSTRAINT "payments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "payments" p
SET "tip_amount" = a."tip_amount"
FROM "payment_attempts" a
WHERE a."id" = p."payment_attempt_id"
  AND p."tip_amount" = 0
  AND COALESCE(a."tip_amount", 0) > 0
  AND COALESCE(a."tip_amount", 0) <= p."amount";

UPDATE "payments"
SET "source" = 'WEB_QR'
WHERE "source" IS NULL
  AND "provider" IN ('MERCADO_PAGO', 'TRANSBANK');

UPDATE "payments"
SET "method" = 'MERCADO_PAGO'
WHERE "method" IS NULL
  AND "provider" = 'MERCADO_PAGO';
