ALTER TABLE "staff_device_tokens" ADD COLUMN IF NOT EXISTS "sound_enabled" BOOLEAN NOT NULL DEFAULT true;
