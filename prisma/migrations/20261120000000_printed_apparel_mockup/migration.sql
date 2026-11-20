-- Printed apparel items carry a finished-garment mockup image (variant image
-- or product featured image) pushed to the factory as the effect image.
-- IF NOT EXISTS: the column may be pre-applied through the pooler when the
-- direct DB connection isn't reachable from the operator's machine.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "mockup_url" TEXT;
