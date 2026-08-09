CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adapter_type" TEXT NOT NULL,
    "base_url" TEXT,
    "secret_key_env" TEXT NOT NULL,
    "platform_type" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_mappings" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_pushes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "platform_oid" TEXT NOT NULL,
    "item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pushed_at" TIMESTAMP(3),
    "order_status" INTEGER,
    "order_status_str" TEXT,
    "status_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "request_payload" JSONB,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pushes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_items"
ADD COLUMN "vendor" TEXT,
ADD COLUMN "print_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supplier_id" TEXT,
ADD COLUMN "supplier_pushed_at" TIMESTAMP(3),
ADD COLUMN "supplier_order_no" TEXT,
ADD COLUMN "supplier_trace_id" TEXT;

ALTER TABLE "sku_mappings"
ADD COLUMN "supplier_id" TEXT;

DROP INDEX "sku_mappings_our_sku_variant_title_key";

CREATE UNIQUE INDEX "suppliers_key_key" ON "suppliers"("key");
CREATE UNIQUE INDEX "vendor_mappings_vendor_key" ON "vendor_mappings"("vendor");
CREATE INDEX "vendor_mappings_supplier_id_idx" ON "vendor_mappings"("supplier_id");
CREATE UNIQUE INDEX "supplier_pushes_platform_oid_key" ON "supplier_pushes"("platform_oid");
CREATE INDEX "supplier_pushes_order_id_idx" ON "supplier_pushes"("order_id");
CREATE INDEX "supplier_pushes_supplier_id_idx" ON "supplier_pushes"("supplier_id");
CREATE INDEX "supplier_pushes_order_status_idx" ON "supplier_pushes"("order_status");
CREATE INDEX "supplier_pushes_pushed_at_idx" ON "supplier_pushes"("pushed_at");
CREATE INDEX "order_items_vendor_idx" ON "order_items"("vendor");
CREATE UNIQUE INDEX "sku_mappings_our_sku_variant_title_supplier_id_key" ON "sku_mappings"("our_sku", "variant_title", "supplier_id");
CREATE INDEX "sku_mappings_supplier_id_idx" ON "sku_mappings"("supplier_id");

ALTER TABLE "vendor_mappings"
ADD CONSTRAINT "vendor_mappings_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_pushes"
ADD CONSTRAINT "supplier_pushes_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_pushes"
ADD CONSTRAINT "supplier_pushes_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_items"
ADD CONSTRAINT "order_items_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sku_mappings"
ADD CONSTRAINT "sku_mappings_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
