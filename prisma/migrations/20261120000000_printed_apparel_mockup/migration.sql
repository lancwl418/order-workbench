-- Printed apparel items carry a finished-garment mockup image (variant image
-- or product featured image) pushed to the factory as the effect image.
ALTER TABLE "order_items" ADD COLUMN "mockup_url" TEXT;
