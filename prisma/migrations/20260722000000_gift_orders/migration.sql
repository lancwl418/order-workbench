CREATE TYPE "GiftOrderStatus" AS ENUM ('READY', 'PUSHING', 'PUSHED', 'FAILED');

CREATE TABLE "gift_segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gift_title" TEXT NOT NULL,
    "gift_sku" TEXT NOT NULL,
    "gift_quantity" INTEGER NOT NULL DEFAULT 1,
    "gift_value" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "weight_lbs" DOUBLE PRECISION NOT NULL,
    "length_in" DOUBLE PRECISION NOT NULL,
    "width_in" DOUBLE PRECISION NOT NULL,
    "height_in" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_segments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gift_orders" (
    "id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "customer_external_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "shipping_address" JSONB NOT NULL,
    "status" "GiftOrderStatus" NOT NULL DEFAULT 'READY',
    "error_message" TEXT,
    "oms_order_no" TEXT,
    "tracking_number" TEXT,
    "carrier" TEXT,
    "service" TEXT,
    "shipping_cost" DECIMAL(10,2),
    "oms_raw_json" JSONB,
    "pushed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gift_orders_oms_order_no_key" ON "gift_orders"("oms_order_no");
CREATE UNIQUE INDEX "gift_orders_segment_id_customer_external_id_key" ON "gift_orders"("segment_id", "customer_external_id");
CREATE INDEX "gift_segments_created_at_idx" ON "gift_segments"("created_at");
CREATE INDEX "gift_orders_segment_id_status_idx" ON "gift_orders"("segment_id", "status");
CREATE INDEX "gift_orders_created_at_idx" ON "gift_orders"("created_at");

ALTER TABLE "gift_orders"
ADD CONSTRAINT "gift_orders_segment_id_fkey"
FOREIGN KEY ("segment_id") REFERENCES "gift_segments"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
