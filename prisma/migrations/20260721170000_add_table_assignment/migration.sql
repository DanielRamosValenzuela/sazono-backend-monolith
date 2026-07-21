-- AlterTable
ALTER TABLE "branch_settings" ADD COLUMN "table_assignment_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "table_sessions" ADD COLUMN "assigned_staff_user_id" UUID;

-- AddForeignKey
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_assigned_staff_user_id_fkey" FOREIGN KEY ("assigned_staff_user_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
