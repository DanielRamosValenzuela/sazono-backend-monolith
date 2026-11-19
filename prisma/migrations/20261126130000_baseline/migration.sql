-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PlatformAdminStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "StaffUserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "BranchRoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUPERVISOR', 'WAITER', 'KITCHEN', 'BAR', 'CASHIER');

-- CreateEnum
CREATE TYPE "MenuStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MenuCategoryStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TableSessionOpenedBySource" AS ENUM ('QR', 'WAITER', 'HOST', 'CASHIER');

-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('OPEN', 'PAYMENT_COMPLETED', 'CLOSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('FOOD', 'DRINK', 'DESSERT', 'PACKAGED', 'SERVICE');

-- CreateEnum
CREATE TYPE "PreparationStationType" AS ENUM ('KITCHEN', 'BAR', 'DESSERT', 'COFFEE', 'OTHER');

-- CreateEnum
CREATE TYPE "PreparationStationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('QR', 'WAITER', 'MIXED');

-- CreateEnum
CREATE TYPE "PaymentPolicy" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'CONFIRMED', 'ROUTED', 'IN_PREPARATION', 'PARTIALLY_READY', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StationTicketStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'ABANDONED', 'VOID');

-- CreateEnum
CREATE TYPE "BillItemStatus" AS ENUM ('OPEN', 'PAID', 'VOID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillSplitMode" AS ENUM ('BY_ITEM', 'BY_AMOUNT', 'BY_PERCENTAGE');

-- CreateEnum
CREATE TYPE "BillSplitStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillSplitParticipantStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'FAILED', 'SUCCEEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TranslationEntityType" AS ENUM ('MENU', 'MENU_CATEGORY', 'MENU_ITEM');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "default_language" TEXT NOT NULL DEFAULT 'es',
    "timezone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_settings" (
    "branch_id" UUID NOT NULL,
    "qr_ordering_enabled" BOOLEAN NOT NULL DEFAULT true,
    "qr_payment_mode" TEXT NOT NULL DEFAULT 'prepaid_order',
    "split_bill_enabled" BOOLEAN NOT NULL DEFAULT true,
    "partial_delivery_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_menu_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_settings_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "status" "StaffUserStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_user_branch_roles" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "BranchRoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_user_branch_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "qr_token" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_sessions" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "TableSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_by_source" "TableSessionOpenedBySource" NOT NULL,
    "opened_by_staff_user_id" UUID,
    "closed_by_staff_user_id" UUID,
    "close_reason" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "table_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MenuStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3),
    "default_language" TEXT NOT NULL DEFAULT 'es',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "MenuCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preparation_stations" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "station_type" "PreparationStationType" NOT NULL,
    "status" "PreparationStationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "preparation_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "menu_category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "sku" TEXT,
    "item_type" "MenuItemType" NOT NULL,
    "preparation_station_id" UUID NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_media" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "media_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_item_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "entity_type" "TranslationEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "translated_value" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remaining_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "resolved_by_staff_user_id" UUID,
    "close_reason" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "table_session_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "source" "OrderSource" NOT NULL,
    "payment_policy" "PaymentPolicy" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_staff_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID,
    "preparation_station_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "price_snapshot" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_tickets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "preparation_station_id" UUID NOT NULL,
    "status" "StationTicketStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_ticket_items" (
    "id" UUID NOT NULL,
    "station_ticket_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_ticket_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_items" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "order_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "status" "BillItemStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_splits" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "split_mode" "BillSplitMode" NOT NULL,
    "status" "BillSplitStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_split_participants" (
    "id" UUID NOT NULL,
    "bill_split_id" UUID NOT NULL,
    "participant_token" TEXT NOT NULL,
    "display_name" TEXT,
    "allocated_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "BillSplitParticipantStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_split_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_split_participant_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CLP',
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "bill_id" UUID,
    "amount" DECIMAL(12,2),
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_restaurant_id_idx" ON "branches"("restaurant_id");

-- CreateIndex
CREATE INDEX "branch_settings_default_menu_id_idx" ON "branch_settings"("default_menu_id");

-- CreateIndex
CREATE INDEX "staff_users_restaurant_id_idx" ON "staff_users"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_auth_user_id_restaurant_id_key" ON "staff_users"("auth_user_id", "restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_auth_user_id_key" ON "platform_admins"("auth_user_id");

-- CreateIndex
CREATE INDEX "staff_user_branch_roles_branch_id_idx" ON "staff_user_branch_roles"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_branch_roles_staff_user_id_branch_id_role_key" ON "staff_user_branch_roles"("staff_user_id", "branch_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "tables_qr_token_key" ON "tables"("qr_token");

-- CreateIndex
CREATE UNIQUE INDEX "tables_branch_id_code_key" ON "tables"("branch_id", "code");

-- CreateIndex
CREATE INDEX "table_sessions_table_id_idx" ON "table_sessions"("table_id");

-- CreateIndex
CREATE INDEX "table_sessions_branch_id_status_idx" ON "table_sessions"("branch_id", "status");

-- CreateIndex
CREATE INDEX "menus_branch_id_status_idx" ON "menus"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "menus_branch_id_version_key" ON "menus"("branch_id", "version");

-- CreateIndex
CREATE INDEX "menu_categories_menu_id_sort_order_idx" ON "menu_categories"("menu_id", "sort_order");

-- CreateIndex
CREATE INDEX "preparation_stations_branch_id_station_type_idx" ON "preparation_stations"("branch_id", "station_type");

-- CreateIndex
CREATE UNIQUE INDEX "preparation_stations_branch_id_name_key" ON "preparation_stations"("branch_id", "name");

-- CreateIndex
CREATE INDEX "menu_items_menu_category_id_is_available_idx" ON "menu_items"("menu_category_id", "is_available");

-- CreateIndex
CREATE INDEX "menu_items_preparation_station_id_idx" ON "menu_items"("preparation_station_id");

-- CreateIndex
CREATE INDEX "menu_item_media_menu_item_id_sort_order_idx" ON "menu_item_media"("menu_item_id", "sort_order");

-- CreateIndex
CREATE INDEX "translations_entity_type_entity_id_locale_field_name_idx" ON "translations"("entity_type", "entity_id", "locale", "field_name");

-- CreateIndex
CREATE UNIQUE INDEX "bills_table_session_id_key" ON "bills"("table_session_id");

-- CreateIndex
CREATE INDEX "bills_branch_id_status_idx" ON "bills"("branch_id", "status");

-- CreateIndex
CREATE INDEX "orders_table_session_id_idx" ON "orders"("table_session_id");

-- CreateIndex
CREATE INDEX "orders_bill_id_idx" ON "orders"("bill_id");

-- CreateIndex
CREATE INDEX "orders_branch_id_status_idx" ON "orders"("branch_id", "status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_preparation_station_id_status_idx" ON "order_items"("preparation_station_id", "status");

-- CreateIndex
CREATE INDEX "station_tickets_order_id_idx" ON "station_tickets"("order_id");

-- CreateIndex
CREATE INDEX "station_tickets_branch_id_preparation_station_id_status_idx" ON "station_tickets"("branch_id", "preparation_station_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "station_ticket_items_station_ticket_id_order_item_id_key" ON "station_ticket_items"("station_ticket_id", "order_item_id");

-- CreateIndex
CREATE INDEX "bill_items_bill_id_idx" ON "bill_items"("bill_id");

-- CreateIndex
CREATE INDEX "bill_items_order_item_id_idx" ON "bill_items"("order_item_id");

-- CreateIndex
CREATE INDEX "bill_splits_bill_id_status_idx" ON "bill_splits"("bill_id", "status");

-- CreateIndex
CREATE INDEX "bill_split_participants_bill_split_id_status_idx" ON "bill_split_participants"("bill_split_id", "status");

-- CreateIndex
CREATE INDEX "payments_bill_id_status_idx" ON "payments"("bill_id", "status");

-- CreateIndex
CREATE INDEX "payments_bill_split_participant_id_idx" ON "payments"("bill_split_participant_id");

-- CreateIndex
CREATE INDEX "payment_attempts_order_id_status_idx" ON "payment_attempts"("order_id", "status");

-- CreateIndex
CREATE INDEX "payment_attempts_bill_id_status_idx" ON "payment_attempts"("bill_id", "status");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_default_menu_id_fkey" FOREIGN KEY ("default_menu_id") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_user_branch_roles" ADD CONSTRAINT "staff_user_branch_roles_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_user_branch_roles" ADD CONSTRAINT "staff_user_branch_roles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_opened_by_staff_user_id_fkey" FOREIGN KEY ("opened_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_closed_by_staff_user_id_fkey" FOREIGN KEY ("closed_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preparation_stations" ADD CONSTRAINT "preparation_stations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_category_id_fkey" FOREIGN KEY ("menu_category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_preparation_station_id_fkey" FOREIGN KEY ("preparation_station_id") REFERENCES "preparation_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_media" ADD CONSTRAINT "menu_item_media_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_resolved_by_staff_user_id_fkey" FOREIGN KEY ("resolved_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "table_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_staff_user_id_fkey" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_preparation_station_id_fkey" FOREIGN KEY ("preparation_station_id") REFERENCES "preparation_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_tickets" ADD CONSTRAINT "station_tickets_preparation_station_id_fkey" FOREIGN KEY ("preparation_station_id") REFERENCES "preparation_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_ticket_items" ADD CONSTRAINT "station_ticket_items_station_ticket_id_fkey" FOREIGN KEY ("station_ticket_id") REFERENCES "station_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_ticket_items" ADD CONSTRAINT "station_ticket_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_splits" ADD CONSTRAINT "bill_splits_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_split_participants" ADD CONSTRAINT "bill_split_participants_bill_split_id_fkey" FOREIGN KEY ("bill_split_id") REFERENCES "bill_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_split_participant_id_fkey" FOREIGN KEY ("bill_split_participant_id") REFERENCES "bill_split_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Disable RLS on Prisma's internal migration table so Prisma can manage schema history.
ALTER TABLE public."_prisma_migrations" DISABLE ROW LEVEL SECURITY;

-- Enable RLS on every business table in the public schema.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',
      r.tablename
    );
  END LOOP;
END
$$;

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "menu_items_menu_category_id_sort_order_idx" ON "menu_items"("menu_category_id", "sort_order");

ALTER TABLE "restaurants" ADD COLUMN "slug" TEXT;
ALTER TABLE "restaurants" ADD COLUMN "branch_quota" INTEGER NOT NULL DEFAULT 1;

UPDATE "restaurants"
SET "slug" = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substring(id::text, 1, 8)
WHERE "slug" IS NULL;

ALTER TABLE "restaurants" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_slug_key" UNIQUE ("slug");

CREATE TYPE "LeadIntent" AS ENUM ('DEMO_REQUEST', 'GENERAL_INQUIRY');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

CREATE TABLE "leads" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "business_name" TEXT,
  "intent" "LeadIntent" NOT NULL DEFAULT 'GENERAL_INQUIRY',
  "message" TEXT,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_status_created_at_idx" ON "leads" ("status", "created_at");

-- CreateEnum
CREATE TYPE "ModifierSelectionType" AS ENUM ('ONE', 'MANY');

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "selection_type" "ModifierSelectionType" NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_options" (
    "id" UUID NOT NULL,
    "modifier_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modifier_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_modifier_groups" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "modifier_group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_item_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_modifiers" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "modifier_option_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "price_delta_snapshot" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "modifier_groups_branch_id_idx" ON "modifier_groups"("branch_id");

-- CreateIndex
CREATE INDEX "modifier_options_modifier_group_id_sort_order_idx" ON "modifier_options"("modifier_group_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "menu_item_modifier_groups_menu_item_id_modifier_group_id_key" ON "menu_item_modifier_groups"("menu_item_id", "modifier_group_id");

-- CreateIndex
CREATE INDEX "menu_item_modifier_groups_modifier_group_id_idx" ON "menu_item_modifier_groups"("modifier_group_id");

-- CreateIndex
CREATE INDEX "order_item_modifiers_order_item_id_idx" ON "order_item_modifiers"("order_item_id");

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_options" ADD CONSTRAINT "modifier_options_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_modifier_groups" ADD CONSTRAINT "menu_item_modifier_groups_modifier_group_id_fkey" FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_option_id_fkey" FOREIGN KEY ("modifier_option_id") REFERENCES "modifier_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EnableRowLevelSecurity
-- The blanket RLS-enable loop in 20260708123000_enable_rls_public_tables only ran once
-- against the tables that existed at that time; new tables need this explicitly.
ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "modifier_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "menu_item_modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_item_modifiers" ENABLE ROW LEVEL SECURITY;

-- Safety: map any existing ACCEPTED rows to PENDING before recreating the enum type.
-- Business logic already treats ACCEPTED identically to PENDING
-- (see src/modules/orders/domain/order-status-from-tickets.ts), so this is a no-op
-- in terms of observable order status.
UPDATE "station_tickets" SET "status" = 'PENDING' WHERE "status" = 'ACCEPTED';

-- Recreate StationTicketStatus without ACCEPTED.
-- Postgres does not support dropping a single value from an enum type directly.
CREATE TYPE "StationTicketStatus_new" AS ENUM ('PENDING', 'IN_PROGRESS', 'READY', 'CANCELLED');
ALTER TABLE "station_tickets" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "station_tickets" ALTER COLUMN "status" TYPE "StationTicketStatus_new" USING ("status"::text::"StationTicketStatus_new");
DROP TYPE "StationTicketStatus";
ALTER TYPE "StationTicketStatus_new" RENAME TO "StationTicketStatus";
ALTER TABLE "station_tickets" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "branch_settings" ADD COLUMN "auto_deliver_after_minutes" INTEGER;

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

-- AlterTable
ALTER TABLE "branch_settings" ADD COLUMN "table_assignment_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN "assigned_staff_user_id" UUID;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_assigned_staff_user_id_fkey" FOREIGN KEY ("assigned_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_users" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "staff_users" ADD COLUMN "pin_set_at" TIMESTAMPTZ(3);
ALTER TABLE "staff_users" ADD COLUMN "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "staff_users" ADD COLUMN "pin_locked_until" TIMESTAMPTZ(3);

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

CREATE TYPE "PaymentGatewayProvider" AS ENUM ('MERCADO_PAGO');

CREATE TYPE "PaymentAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "restaurant_payment_accounts" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'PENDING',
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "external_account_id" TEXT,
    "public_key" TEXT,
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "live_mode" BOOLEAN NOT NULL DEFAULT false,
    "application_fee_bps" INTEGER,
    "connected_at" TIMESTAMPTZ(3),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restaurant_payment_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_oauth_states" (
    "id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "created_by_staff_user_id" UUID NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL,
    "code_verifier" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "process_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_attempts" ADD COLUMN "restaurant_payment_account_id" UUID;
ALTER TABLE "payment_attempts" ADD COLUMN "provider_status" TEXT;
ALTER TABLE "payment_attempts" ADD COLUMN "provider_status_detail" TEXT;

ALTER TABLE "payments" ADD COLUMN "payment_attempt_id" UUID;

CREATE UNIQUE INDEX "restaurant_payment_accounts_restaurant_id_provider_key" ON "restaurant_payment_accounts"("restaurant_id", "provider");

CREATE UNIQUE INDEX "payment_oauth_states_state_key" ON "payment_oauth_states"("state");

CREATE INDEX "payment_oauth_states_expires_at_idx" ON "payment_oauth_states"("expires_at");

CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

CREATE INDEX "payment_webhook_events_provider_resource_id_idx" ON "payment_webhook_events"("provider", "resource_id");

CREATE INDEX "payment_attempts_provider_provider_reference_idx" ON "payment_attempts"("provider", "provider_reference");

CREATE UNIQUE INDEX "payments_payment_attempt_id_key" ON "payments"("payment_attempt_id");

CREATE UNIQUE INDEX "payments_provider_provider_reference_key" ON "payments"("provider", "provider_reference");

ALTER TABLE "restaurant_payment_accounts" ADD CONSTRAINT "restaurant_payment_accounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_oauth_states" ADD CONSTRAINT "payment_oauth_states_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_oauth_states" ADD CONSTRAINT "payment_oauth_states_created_by_staff_user_id_fkey" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_restaurant_payment_account_id_fkey" FOREIGN KEY ("restaurant_payment_account_id") REFERENCES "restaurant_payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public."_prisma_migrations" DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',
      r.tablename
    );
  END LOOP;
END
$$;

ALTER TYPE "PaymentAccountStatus" ADD VALUE 'PAUSED';

ALTER TABLE "restaurant_payment_accounts" ADD COLUMN "display_priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "restaurant_payment_accounts" ADD COLUMN "child_commerce_code" TEXT;

ALTER TYPE "PaymentGatewayProvider" ADD VALUE 'TRANSBANK';

ALTER TABLE "payment_attempts" ADD COLUMN "tip_amount" DECIMAL(12,2);
ALTER TABLE "payment_attempts" ADD COLUMN "bill_split_participant_id" UUID;

CREATE INDEX "payment_attempts_bill_split_participant_id_idx" ON "payment_attempts"("bill_split_participant_id");

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_bill_split_participant_id_fkey" FOREIGN KEY ("bill_split_participant_id") REFERENCES "bill_split_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

ALTER TABLE "modifier_options" ADD COLUMN "image_url" TEXT;

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

ALTER TABLE "menu_categories" ADD COLUMN "parent_id" UUID;

ALTER TABLE "order_items" ADD COLUMN "category_path_snapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "menu_category_id" UUID;

CREATE INDEX "menu_categories_menu_id_parent_id_sort_order_idx" ON "menu_categories"("menu_id", "parent_id", "sort_order");

ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "order_items" oi
SET "menu_category_id" = mi."menu_category_id"
FROM "menu_items" mi
WHERE mi."id" = oi."menu_item_id"
  AND oi."menu_category_id" IS NULL;

UPDATE "order_items" oi
SET "category_path_snapshot" = ARRAY[mc."name"]
FROM "menu_items" mi
JOIN "menu_categories" mc ON mc."id" = mi."menu_category_id"
WHERE mi."id" = oi."menu_item_id"
  AND (oi."category_path_snapshot" IS NULL OR cardinality(oi."category_path_snapshot") = 0);

UPDATE "order_items"
SET "category_path_snapshot" = ARRAY['(Sin categoria)']
WHERE "category_path_snapshot" IS NULL OR cardinality("category_path_snapshot") = 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payments"
    WHERE "amount" < 0 OR "tip_amount" < 0 OR "tip_amount" > "amount"
  ) THEN
    RAISE EXCEPTION 'M4 precheck: existen pagos con monto negativo o propina inconsistente; corrigelos antes de migrar';
  END IF;
END
$$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REQUIRES_MANUAL_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundMethod" AS ENUM ('CASH_MANUAL', 'GATEWAY', 'MANUAL_EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundReason" AS ENUM ('CUSTOMER_COMPLAINT', 'WRONG_ORDER', 'DISH_UNAVAILABLE', 'QUALITY_ISSUE', 'DUPLICATE_CHARGE', 'CASHIER_ERROR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT', 'REFUND_OUT', 'TIP_PAYOUT', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "bills"
  ADD COLUMN IF NOT EXISTS "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "staff_users"
  ADD COLUMN IF NOT EXISTS "approval_pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "approval_pin_locked_until" TIMESTAMPTZ(3);

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "cashier_refund_limit" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "refund_tip_default" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_amount_range_check"
    CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_tip_range_check"
    CHECK ("refunded_tip_amount" >= 0 AND "refunded_tip_amount" <= "tip_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_consumption_range_check"
    CHECK (("refunded_amount" - "refunded_tip_amount") >= 0 AND ("refunded_amount" - "refunded_tip_amount") <= ("amount" - "tip_amount")) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_refunded_amount_check"
    CHECK ("refunded_amount" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_cashier_refund_limit_check"
    CHECK ("cashier_refund_limit" IS NULL OR "cashier_refund_limit" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_amount_range_check";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_tip_range_check";
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_refunded_consumption_range_check";
ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_refunded_amount_check";
ALTER TABLE "branch_settings" VALIDATE CONSTRAINT "branch_settings_cashier_refund_limit_check";

CREATE TABLE IF NOT EXISTS "refunds" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tip_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "method" "RefundMethod" NOT NULL,
    "reason_code" "RefundReason" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "provider" TEXT NOT NULL,
    "provider_refund_reference" TEXT,
    "provider_raw" JSONB,
    "failure_reason" TEXT,
    "requested_by_staff_user_id" UUID,
    "requested_by_role" "Role",
    "approved_by_staff_user_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "credit_note_status" TEXT NOT NULL DEFAULT 'PENDING',
    "credit_note_folio" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refunds_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "refunds_tip_range_check" CHECK ("tip_amount" >= 0 AND "tip_amount" <= "amount"),
    CONSTRAINT "refunds_breakdown_check" CHECK ("net_amount" >= 0 AND "vat_amount" >= 0 AND "net_amount" + "vat_amount" = "amount" - "tip_amount"),
    CONSTRAINT "refunds_reason_text_check" CHECK (char_length(btrim("reason_text")) >= 3),
    CONSTRAINT "refunds_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 100),
    CONSTRAINT "refunds_completed_at_check" CHECK ("status" <> 'SUCCEEDED' OR "completed_at" IS NOT NULL),
    CONSTRAINT "refunds_source_check" CHECK ("source" IN ('STAFF', 'WEBHOOK', 'RECONCILIATION')),
    CONSTRAINT "refunds_credit_note_status_check" CHECK ("credit_note_status" IN ('PENDING', 'ISSUED', 'NOT_REQUIRED'))
);

CREATE TABLE IF NOT EXISTS "cash_movements" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "payment_id" UUID,
    "refund_id" UUID,
    "staff_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movements_amount_check" CHECK (
      ("type" = 'CASH_IN' AND "amount" > 0)
      OR ("type" IN ('CASH_OUT', 'REFUND_OUT', 'TIP_PAYOUT') AND "amount" < 0)
      OR ("type" = 'ADJUSTMENT' AND "amount" <> 0)
    ),
    CONSTRAINT "cash_movements_reason_check" CHECK (char_length(btrim("reason")) >= 3)
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID,
    "branch_id" UUID,
    "actor_staff_user_id" UUID,
    "actor_platform_admin_id" UUID,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "refunds_bill_id_idx" ON "refunds"("bill_id");
CREATE INDEX IF NOT EXISTS "refunds_payment_id_status_idx" ON "refunds"("payment_id", "status");
CREATE INDEX IF NOT EXISTS "refunds_branch_id_completed_at_idx" ON "refunds"("branch_id", "completed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_payment_id_idempotency_key_key" ON "refunds"("payment_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_provider_provider_refund_reference_key" ON "refunds"("provider", "provider_refund_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_movements_refund_id_key" ON "cash_movements"("refund_id");
CREATE INDEX IF NOT EXISTS "cash_movements_branch_id_created_at_idx" ON "cash_movements"("branch_id", "created_at");
CREATE INDEX IF NOT EXISTS "cash_movements_payment_id_idx" ON "cash_movements"("payment_id");
CREATE INDEX IF NOT EXISTS "audit_logs_restaurant_id_created_at_idx" ON "audit_logs"("restaurant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_user_id_fkey" FOREIGN KEY ("requested_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_user_id_fkey" FOREIGN KEY ("approved_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION "audit_logs_immutable"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs es de solo insercion';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_logs_immutable_trg" ON "audit_logs";
CREATE TRIGGER "audit_logs_immutable_trg"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"();

DROP TRIGGER IF EXISTS "audit_logs_no_truncate_trg" ON "audit_logs";
CREATE TRIGGER "audit_logs_no_truncate_trg"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_immutable"();

CREATE OR REPLACE FUNCTION "cash_movements_immutable"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements es de solo insercion';
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cash_movements_immutable_trg" ON "cash_movements";
CREATE TRIGGER "cash_movements_immutable_trg"
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "cash_movements_immutable"();

DROP TRIGGER IF EXISTS "cash_movements_no_truncate_trg" ON "cash_movements";
CREATE TRIGGER "cash_movements_no_truncate_trg"
  BEFORE TRUNCATE ON "cash_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_movements_immutable"();

CREATE OR REPLACE FUNCTION "refunds_guard"() RETURNS trigger
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds no se puede borrar';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."tip_amount" IS DISTINCT FROM OLD."tip_amount"
    OR NEW."net_amount" IS DISTINCT FROM OLD."net_amount"
    OR NEW."vat_amount" IS DISTINCT FROM OLD."vat_amount"
    OR NEW."restaurant_id" IS DISTINCT FROM OLD."restaurant_id"
    OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
    OR NEW."bill_id" IS DISTINCT FROM OLD."bill_id"
    OR NEW."payment_id" IS DISTINCT FROM OLD."payment_id" THEN
    RAISE EXCEPTION 'refunds: las columnas financieras son inmutables';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "refunds_guard_trg" ON "refunds";
CREATE TRIGGER "refunds_guard_trg"
  BEFORE UPDATE OR DELETE ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_guard"();

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "platform_fee_bps" INTEGER NOT NULL DEFAULT 100;

DO $$ BEGIN
  CREATE TYPE "PlatformFeeStatementStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'WAIVED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "platform_fee_statements" (
  "id" UUID NOT NULL,
  "restaurant_id" UUID NOT NULL,
  "period_month" DATE NOT NULL,
  "gross_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tips_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discounts" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "refunds_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "carry_over_in" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "net_sales" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "fee_bps" INTEGER NOT NULL,
  "fee_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
  "status" "PlatformFeeStatementStatus" NOT NULL DEFAULT 'DRAFT',
  "breakdown" JSONB,
  "notes" TEXT,
  "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_at" TIMESTAMPTZ(3),
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_fee_statements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_fee_statements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_fee_statements_fee_bps_check" CHECK ("fee_bps" >= 0 AND "fee_bps" <= 10000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_fee_statements_restaurant_id_period_month_key"
  ON "platform_fee_statements" ("restaurant_id", "period_month");
CREATE INDEX IF NOT EXISTS "platform_fee_statements_period_month_status_idx"
  ON "platform_fee_statements" ("period_month", "status");

ALTER TABLE "platform_fee_statements" ENABLE ROW LEVEL SECURITY;

UPDATE "restaurant_payment_accounts" SET "application_fee_bps" = 0 WHERE "application_fee_bps" > 0;

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "bills"
    WHERE "total_amount" <> "subtotal_amount" + "tip_amount" + "tax_amount"
  ) THEN
    RAISE EXCEPTION 'M8a precheck: existen cuentas con total distinto de subtotal + propina + impuesto; corrigelas antes de migrar';
  END IF;
END
$$;

DO $$ BEGIN
  CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountReason" AS ENUM ('COURTESY', 'CUSTOMER_COMPLAINT', 'STAFF_MEAL', 'PROMOTION', 'LOYALTY', 'PRICE_ERROR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bills"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "bill_items"
  ADD COLUMN IF NOT EXISTS "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "discount_approval_percent" DECIMAL(5,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "discount_approval_amount" DECIMAL(12,2);

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_discount_amount_range_check"
    CHECK ("discount_amount" >= 0 AND "discount_amount" <= "subtotal_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bills" ADD CONSTRAINT "bills_total_formula_check"
    CHECK ("total_amount" = "subtotal_amount" - "discount_amount" + "tip_amount" + "tax_amount") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_discount_amount_range_check"
    CHECK ("discount_amount" >= 0 AND "discount_amount" <= "total_price") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_discount_approval_check"
    CHECK (
      ("discount_approval_percent" IS NULL OR ("discount_approval_percent" >= 0 AND "discount_approval_percent" <= 100))
      AND ("discount_approval_amount" IS NULL OR "discount_approval_amount" >= 0)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_discount_amount_range_check";
ALTER TABLE "bills" VALIDATE CONSTRAINT "bills_total_formula_check";
ALTER TABLE "bill_items" VALIDATE CONSTRAINT "bill_items_discount_amount_range_check";
ALTER TABLE "branch_settings" VALIDATE CONSTRAINT "branch_settings_discount_approval_check";

CREATE TABLE IF NOT EXISTS "bill_discounts" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_item_id" UUID,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason_code" "DiscountReason" NOT NULL,
    "reason_text" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "applied_by_staff_user_id" UUID NOT NULL,
    "applied_by_role" "Role" NOT NULL,
    "approved_by_staff_user_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_staff_user_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bill_discounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bill_discounts_value_check" CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 100)),
    CONSTRAINT "bill_discounts_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "bill_discounts_reason_text_check" CHECK (char_length(btrim("reason_text")) >= 3),
    CONSTRAINT "bill_discounts_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 100),
    CONSTRAINT "bill_discounts_void_check" CHECK (
      ("voided_at" IS NULL AND "voided_by_staff_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("voided_at" IS NOT NULL AND "voided_by_staff_user_id" IS NOT NULL AND char_length(btrim("void_reason")) >= 3)
    )
);

CREATE INDEX IF NOT EXISTS "bill_discounts_bill_id_idx" ON "bill_discounts"("bill_id");
CREATE INDEX IF NOT EXISTS "bill_discounts_bill_item_id_idx" ON "bill_discounts"("bill_item_id");
CREATE INDEX IF NOT EXISTS "bill_discounts_branch_id_created_at_idx" ON "bill_discounts"("branch_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_bill_id_idempotency_key_key" ON "bill_discounts"("bill_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_one_active_per_bill_idx"
  ON "bill_discounts"("bill_id")
  WHERE "bill_item_id" IS NULL AND "voided_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "bill_discounts_one_active_per_item_idx"
  ON "bill_discounts"("bill_item_id")
  WHERE "bill_item_id" IS NOT NULL AND "voided_at" IS NULL;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_applied_by_staff_user_id_fkey" FOREIGN KEY ("applied_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_approved_by_staff_user_id_fkey" FOREIGN KEY ("approved_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "bill_discounts" ADD CONSTRAINT "bill_discounts_voided_by_staff_user_id_fkey" FOREIGN KEY ("voided_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bill_discounts" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "branch_settings"
  ADD COLUMN IF NOT EXISTS "require_open_cash_session" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "cash_sessions" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "register_label" TEXT NOT NULL DEFAULT 'Caja 1',
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "cashier_staff_user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opening_float" DECIMAL(12,2) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_staff_user_id" UUID,
    "expected_cash" DECIMAL(12,2),
    "cash_sales_amount" DECIMAL(12,2),
    "movements_amount" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "closing_note" TEXT,
    "denominations" JSONB,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_sessions_opening_float_check" CHECK ("opening_float" >= 0),
    CONSTRAINT "cash_sessions_label_check" CHECK (char_length("register_label") BETWEEN 1 AND 40 AND "register_label" = btrim("register_label")),
    CONSTRAINT "cash_sessions_state_check" CHECK (
      ("status" = 'OPEN'
        AND "closed_at" IS NULL AND "closed_by_staff_user_id" IS NULL
        AND "expected_cash" IS NULL AND "counted_cash" IS NULL AND "difference" IS NULL)
      OR ("status" = 'CLOSED'
        AND "closed_at" IS NOT NULL AND "closed_by_staff_user_id" IS NOT NULL
        AND "expected_cash" IS NOT NULL AND "counted_cash" IS NOT NULL AND "difference" IS NOT NULL
        AND "counted_cash" >= 0 AND "difference" = "counted_cash" - "expected_cash")
    ),
    CONSTRAINT "cash_sessions_difference_note_check" CHECK (
      "difference" IS NULL OR "difference" = 0 OR char_length(btrim("closing_note")) >= 3
    )
);

CREATE INDEX IF NOT EXISTS "cash_sessions_branch_id_opened_at_idx" ON "cash_sessions"("branch_id", "opened_at");
CREATE INDEX IF NOT EXISTS "cash_sessions_cashier_staff_user_id_status_idx" ON "cash_sessions"("cashier_staff_user_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_register_idx"
  ON "cash_sessions"("branch_id", lower("register_label"))
  WHERE "status" = 'OPEN';

CREATE UNIQUE INDEX IF NOT EXISTS "cash_sessions_one_open_per_cashier_idx"
  ON "cash_sessions"("branch_id", "cashier_staff_user_id")
  WHERE "status" = 'OPEN';

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_cashier_staff_user_id_fkey" FOREIGN KEY ("cashier_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_staff_user_id_fkey" FOREIGN KEY ("closed_by_staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "cash_session_id" UUID;

ALTER TABLE "cash_movements"
  ADD COLUMN IF NOT EXISTS "cash_session_id" UUID,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_idempotency_key_check"
    CHECK ("idempotency_key" IS NULL OR char_length("idempotency_key") BETWEEN 8 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "payments_cash_session_id_idx" ON "payments"("cash_session_id");
CREATE INDEX IF NOT EXISTS "cash_movements_cash_session_id_idx" ON "cash_movements"("cash_session_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_movements_branch_id_staff_user_id_idempotency_key_key"
  ON "cash_movements"("branch_id", "staff_user_id", "idempotency_key");

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "bill_items"
  ADD COLUMN IF NOT EXISTS "refunded_quantity" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_refunded_quantity_check"
    CHECK ("refunded_quantity" >= 0 AND "refunded_quantity" <= "quantity") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "bill_items" VALIDATE CONSTRAINT "bill_items_refunded_quantity_check";

CREATE TABLE IF NOT EXISTS "refund_items" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "bill_item_id" UUID NOT NULL,
    "order_item_id" UUID,
    "menu_item_id" UUID,
    "preparation_station_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "category_path_snapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kitchen_waste" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refund_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "refund_items_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "refund_items_refund_id_bill_item_id_key" ON "refund_items"("refund_id", "bill_item_id");
CREATE INDEX IF NOT EXISTS "refund_items_bill_item_id_idx" ON "refund_items"("bill_item_id");
CREATE INDEX IF NOT EXISTS "refund_items_kitchen_waste_created_at_idx" ON "refund_items"("kitchen_waste", "created_at");

DO $$ BEGIN
  ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "refund_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "modifier_groups"
  ADD COLUMN IF NOT EXISTS "parent_option_id" UUID;

CREATE INDEX IF NOT EXISTS "modifier_groups_parent_option_id_idx"
  ON "modifier_groups"("parent_option_id");

DO $$ BEGIN
  ALTER TABLE "modifier_groups"
    ADD CONSTRAINT "modifier_groups_parent_option_id_fkey"
    FOREIGN KEY ("parent_option_id") REFERENCES "modifier_options"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "order_item_modifiers"
  ADD COLUMN IF NOT EXISTS "parent_order_item_modifier_id" UUID,
  ADD COLUMN IF NOT EXISTS "depth" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "path_snapshot" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS "order_item_modifiers_parent_order_item_modifier_id_idx"
  ON "order_item_modifiers"("parent_order_item_modifier_id");

DO $$ BEGIN
  ALTER TABLE "order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_parent_order_item_modifier_id_fkey"
    FOREIGN KEY ("parent_order_item_modifier_id") REFERENCES "order_item_modifiers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_item_modifiers"
    ADD CONSTRAINT "order_item_modifiers_depth_check"
    CHECK ("depth" BETWEEN 1 AND 3) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "order_item_modifiers" VALIDATE CONSTRAINT "order_item_modifiers_depth_check";

UPDATE "order_item_modifiers"
  SET "path_snapshot" = ARRAY["name_snapshot"]
  WHERE "path_snapshot" IS NULL OR cardinality("path_snapshot") = 0;
