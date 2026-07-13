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
