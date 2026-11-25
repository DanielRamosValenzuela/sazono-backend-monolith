DO $$ BEGIN
  CREATE TYPE "PrinterTransport" AS ENUM ('SIMULATED', 'TCP', 'APP_BRIDGE', 'BROWSER', 'AGENT', 'CLOUDPRNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrinterStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'PRINTED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobKind" AS ENUM ('COMANDA', 'VOID', 'TEST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PrintDeviceKind" AS ENUM ('ANDROID_APP', 'BROWSER', 'AGENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "business_day_start_hour" INTEGER NOT NULL DEFAULT 4;

ALTER TABLE "preparation_stations"
  ADD COLUMN IF NOT EXISTS "print_code" TEXT;

ALTER TABLE "station_tickets"
  ADD COLUMN IF NOT EXISTS "business_date" DATE,
  ADD COLUMN IF NOT EXISTS "display_number" TEXT;

CREATE TABLE IF NOT EXISTS "printers" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "transport" "PrinterTransport" NOT NULL,
  "connection" JSONB NOT NULL DEFAULT '{}',
  "paper_width_mm" INTEGER NOT NULL DEFAULT 58,
  "columns" INTEGER NOT NULL DEFAULT 32,
  "codepage" TEXT NOT NULL DEFAULT 'cp858',
  "esc_t_codepage_id" INTEGER,
  "copies" INTEGER NOT NULL DEFAULT 1,
  "auto_cut" BOOLEAN NOT NULL DEFAULT true,
  "cash_drawer" BOOLEAN NOT NULL DEFAULT false,
  "print_void_slips" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "status" "PrinterStatus" NOT NULL DEFAULT 'UNKNOWN',
  "last_seen_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "printers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "printers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "printer_stations" (
  "printer_id" UUID NOT NULL,
  "preparation_station_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printer_stations_pkey" PRIMARY KEY ("printer_id", "preparation_station_id"),
  CONSTRAINT "printer_stations_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "printer_stations_preparation_station_id_fkey" FOREIGN KEY ("preparation_station_id") REFERENCES "preparation_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "print_devices" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "kind" "PrintDeviceKind" NOT NULL,
  "name" TEXT NOT NULL,
  "token_hash" TEXT,
  "pairing_code_hash" TEXT,
  "pairing_expires_at" TIMESTAMPTZ(3),
  "app_version" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "print_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "print_device_printers" (
  "device_id" UUID NOT NULL,
  "printer_id" UUID NOT NULL,
  CONSTRAINT "print_device_printers_pkey" PRIMARY KEY ("device_id", "printer_id"),
  CONSTRAINT "print_device_printers_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "print_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "print_device_printers_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "print_jobs" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "printer_id" UUID NOT NULL,
  "station_ticket_id" UUID,
  "kind" "PrintJobKind" NOT NULL DEFAULT 'COMANDA',
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT NOT NULL,
  "reprint_of_id" UUID,
  "document" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_by_device_id" UUID,
  "claimed_by" TEXT,
  "lease_until" TIMESTAMPTZ(3),
  "printed_at" TIMESTAMPTZ(3),
  "duplicate_acks" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "print_jobs_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "print_jobs_station_ticket_id_fkey" FOREIGN KEY ("station_ticket_id") REFERENCES "station_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "print_jobs_reprint_of_id_fkey" FOREIGN KEY ("reprint_of_id") REFERENCES "print_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "print_ticket_counters" (
  "preparation_station_id" UUID NOT NULL,
  "business_date" DATE NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "print_ticket_counters_pkey" PRIMARY KEY ("preparation_station_id", "business_date"),
  CONSTRAINT "print_ticket_counters_preparation_station_id_fkey" FOREIGN KEY ("preparation_station_id") REFERENCES "preparation_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "printers_branch_id_active_idx"
  ON "printers" ("branch_id", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "printers_branch_id_name_key"
  ON "printers" ("branch_id", "name");

CREATE INDEX IF NOT EXISTS "printer_stations_preparation_station_id_idx"
  ON "printer_stations" ("preparation_station_id");

CREATE UNIQUE INDEX IF NOT EXISTS "print_devices_token_hash_key"
  ON "print_devices" ("token_hash");

CREATE INDEX IF NOT EXISTS "print_devices_branch_id_active_idx"
  ON "print_devices" ("branch_id", "active");

CREATE INDEX IF NOT EXISTS "print_device_printers_printer_id_idx"
  ON "print_device_printers" ("printer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "print_jobs_idempotency_key_key"
  ON "print_jobs" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "print_jobs_printer_id_status_next_attempt_at_idx"
  ON "print_jobs" ("printer_id", "status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "print_jobs_branch_id_created_at_idx"
  ON "print_jobs" ("branch_id", "created_at");

CREATE INDEX IF NOT EXISTS "print_jobs_station_ticket_id_idx"
  ON "print_jobs" ("station_ticket_id");

CREATE UNIQUE INDEX IF NOT EXISTS "preparation_stations_branch_id_print_code_key"
  ON "preparation_stations" ("branch_id", "print_code");

ALTER TABLE "printers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "printer_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_device_printers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "print_ticket_counters" ENABLE ROW LEVEL SECURITY;
