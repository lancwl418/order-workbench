-- Ready Print variants can carry several gang sheet URLs
ALTER TABLE "order_items" ADD COLUMN "design_file_urls" TEXT[] NOT NULL DEFAULT '{}';
