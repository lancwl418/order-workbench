CREATE TABLE "supplier_catalog_items" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "style_code" TEXT NOT NULL,
    "style_name" TEXT,
    "color_name" TEXT NOT NULL,
    "size_name" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_catalog_items_supplier_id_style_code_color_name_size_name_key"
ON "supplier_catalog_items"("supplier_id", "style_code", "color_name", "size_name");
CREATE INDEX "supplier_catalog_items_supplier_id_style_code_idx"
ON "supplier_catalog_items"("supplier_id", "style_code");

ALTER TABLE "supplier_catalog_items"
ADD CONSTRAINT "supplier_catalog_items_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
