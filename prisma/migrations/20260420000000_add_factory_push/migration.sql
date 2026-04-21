-- AlterTable: orders — factory push metadata
ALTER TABLE "orders"
  ADD COLUMN "factory_pushed_at" TIMESTAMP(3),
  ADD COLUMN "factory_last_trace_id" TEXT,
  ADD COLUMN "factory_push_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: order_items — per-item factory fields (last pushed values)
ALTER TABLE "order_items"
  ADD COLUMN "factory_sku" TEXT,
  ADD COLUMN "factory_size" TEXT,
  ADD COLUMN "factory_color" TEXT,
  ADD COLUMN "factory_style" TEXT,
  ADD COLUMN "factory_craft_type" INTEGER;

-- CreateTable: sku_mappings — remembered mapping of our sku+variant → factory sku
CREATE TABLE "sku_mappings" (
    "id" TEXT NOT NULL,
    "our_sku" TEXT NOT NULL,
    "variant_title" TEXT NOT NULL,
    "factory_sku" TEXT NOT NULL,
    "factory_size" TEXT,
    "factory_color" TEXT,
    "factory_style" TEXT,
    "factory_craft_type" INTEGER,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sku_mappings_our_sku_variant_title_key" ON "sku_mappings"("our_sku", "variant_title");
CREATE INDEX "sku_mappings_our_sku_idx" ON "sku_mappings"("our_sku");
