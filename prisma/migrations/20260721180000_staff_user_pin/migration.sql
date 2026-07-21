ALTER TABLE "staff_users" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "staff_users" ADD COLUMN "pin_set_at" TIMESTAMPTZ(3);
ALTER TABLE "staff_users" ADD COLUMN "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "staff_users" ADD COLUMN "pin_locked_until" TIMESTAMPTZ(3);
