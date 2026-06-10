-- AlterTable: shipments — link a shipment to the Shopify Fulfillment Order
-- group it covers (split fulfillment). Null = whole order (not split).
ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "shopify_fulfillment_order_id" TEXT;

CREATE INDEX IF NOT EXISTS "shipments_shopify_fulfillment_order_id_idx"
  ON "shipments"("shopify_fulfillment_order_id");
