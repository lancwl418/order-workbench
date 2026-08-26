ALTER TABLE "supplier_pushes"
ADD COLUMN "rejection_status" TEXT,
ADD COLUMN "rejection_handled_by" TEXT,
ADD COLUMN "rejection_handled_at" TIMESTAMP(3);
