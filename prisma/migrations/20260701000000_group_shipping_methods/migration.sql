-- AlterTable: orders — per-group delivery methods + manual-override flag.
-- group_shipping_methods maps shopify_fulfillment_order_id -> delivery method
-- name (e.g. {"7351...": "Express"}) for orders whose fulfillment groups ship
-- with different methods. shipping_method_manual marks an operator override so
-- Shopify sync stops overwriting it.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "group_shipping_methods" JSONB,
  ADD COLUMN IF NOT EXISTS "shipping_method_manual" BOOLEAN NOT NULL DEFAULT false;
