ALTER TABLE "supplier_pushes"
ADD COLUMN "tracking_number" TEXT,
ADD COLUMN "carrier" TEXT,
ADD COLUMN "waybill_url" TEXT,
ADD COLUMN "shipped_at" TIMESTAMP(3);
