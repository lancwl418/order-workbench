-- AlterTable: order_items — split fulfillment grouping
-- Tracks which Shopify Fulfillment Order each item currently belongs to.
-- Null = not split (single default fulfillment order).
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "shopify_fulfillment_order_id" TEXT;

CREATE INDEX IF NOT EXISTS "order_items_shopify_fulfillment_order_id_idx"
  ON "order_items"("shopify_fulfillment_order_id");
