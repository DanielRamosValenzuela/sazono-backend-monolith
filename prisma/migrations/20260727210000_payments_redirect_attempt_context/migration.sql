ALTER TABLE "payment_attempts" ADD COLUMN "tip_amount" DECIMAL(12,2);
ALTER TABLE "payment_attempts" ADD COLUMN "bill_split_participant_id" UUID;

CREATE INDEX "payment_attempts_bill_split_participant_id_idx" ON "payment_attempts"("bill_split_participant_id");

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bill_split_participant_id_fkey" FOREIGN KEY ("bill_split_participant_id") REFERENCES "bill_split_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
