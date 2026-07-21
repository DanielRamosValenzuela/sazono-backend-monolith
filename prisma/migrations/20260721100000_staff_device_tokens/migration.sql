CREATE TABLE "staff_device_tokens" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "fcm_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_device_tokens_staff_user_id_fcm_token_key" ON "staff_device_tokens"("staff_user_id", "fcm_token");

CREATE INDEX "staff_device_tokens_staff_user_id_idx" ON "staff_device_tokens"("staff_user_id");

ALTER TABLE "staff_device_tokens" ADD CONSTRAINT "staff_device_tokens_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
