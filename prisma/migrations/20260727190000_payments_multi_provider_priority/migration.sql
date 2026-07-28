ALTER TYPE "PaymentAccountStatus" ADD VALUE 'PAUSED';

ALTER TABLE "restaurant_payment_accounts" ADD COLUMN "display_priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "restaurant_payment_accounts" ADD COLUMN "child_commerce_code" TEXT;
