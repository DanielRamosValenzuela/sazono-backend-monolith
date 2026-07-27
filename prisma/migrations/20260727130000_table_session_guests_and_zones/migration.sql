ALTER TABLE "table_sessions" ADD COLUMN "guest_count" INTEGER;
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_guest_count_positive" CHECK ("guest_count" IS NULL OR "guest_count" > 0);

CREATE TABLE "table_zones" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "table_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "table_zones_branch_id_name_key" ON "table_zones"("branch_id", "name");

ALTER TABLE "table_zones" ADD CONSTRAINT "table_zones_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tables" ADD COLUMN "zone_id" UUID;

ALTER TABLE "tables" ADD CONSTRAINT "tables_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "table_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "staff_user_zones" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_user_zones_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_user_zones_staff_user_id_zone_id_key" ON "staff_user_zones"("staff_user_id", "zone_id");

ALTER TABLE "staff_user_zones" ADD CONSTRAINT "staff_user_zones_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "staff_user_zones" ADD CONSTRAINT "staff_user_zones_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "table_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "table_sessions_one_active_per_table" ON "table_sessions" ("table_id") WHERE "status" IN ('OPEN', 'PAYMENT_COMPLETED');
