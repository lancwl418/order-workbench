-- Quantity-as-copies only applies to lines sold per sheet (Build a Gangsheet /
-- Upload Gangsheet). Flag set at ingest from the Shopify product id.
-- IF NOT EXISTS: applied manually ahead of deploy (direct db port unreachable
-- from the dev machine), so migrate deploy must re-run this harmlessly.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sold_per_sheet" BOOLEAN NOT NULL DEFAULT false;
