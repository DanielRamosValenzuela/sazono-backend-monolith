-- Ordenes de mostrador: una mesa virtual por sucursal + sesiones con ticket.

-- Renombra cualquier mesa real que use el codigo reservado MOSTRADOR (sin importar mayusculas).
UPDATE "tables" SET "code" = "code" || '-MESA' WHERE upper(btrim("code")) = 'MOSTRADOR';

ALTER TABLE "tables" ADD COLUMN "is_virtual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tables" ADD COLUMN "counter_last_ticket" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "table_sessions" ADD COLUMN "is_counter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "table_sessions" ADD COLUMN "ticket_number" INTEGER;
ALTER TABLE "table_sessions" ADD COLUMN "customer_label" TEXT;

ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_counter_ticket_consistent" CHECK ("is_counter" = ("ticket_number" IS NOT NULL));
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_ticket_number_range" CHECK ("ticket_number" IS NULL OR "ticket_number" BETWEEN 1 AND 999);
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_customer_label_length" CHECK ("customer_label" IS NULL OR char_length("customer_label") <= 40);

-- Una sola mesa virtual por sucursal.
CREATE UNIQUE INDEX "tables_one_virtual_per_branch" ON "tables" ("branch_id") WHERE "is_virtual";

-- Indice nuevo antes de eliminar el viejo: una sesion activa por mesa fisica (las de mostrador conviven).
CREATE UNIQUE INDEX "table_sessions_one_active_per_table_v2" ON "table_sessions" ("table_id") WHERE "status" IN ('OPEN', 'PAYMENT_COMPLETED') AND "is_counter" = false;
DROP INDEX "table_sessions_one_active_per_table";
ALTER INDEX "table_sessions_one_active_per_table_v2" RENAME TO "table_sessions_one_active_per_table";

-- Un ticket activo por numero y sucursal.
CREATE UNIQUE INDEX "table_sessions_one_active_counter_ticket" ON "table_sessions" ("branch_id", "ticket_number") WHERE "is_counter" AND "status" IN ('OPEN', 'PAYMENT_COMPLETED');

-- Listado de tickets de mostrador.
CREATE INDEX "table_sessions_counter_branch_status_idx" ON "table_sessions" ("branch_id", "status") WHERE "is_counter";
