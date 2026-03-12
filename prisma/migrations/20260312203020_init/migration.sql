-- CreateEnum
CREATE TYPE "InternalStatus" AS ENUM ('NEW', 'REVIEW', 'READY_TO_PRINT', 'PRINTING', 'PRINTED', 'READY_TO_SHIP', 'LABEL_CREATED', 'SHIPPED', 'ON_HOLD', 'DELAYED');

-- CreateEnum
CREATE TYPE "ShippingRoute" AS ENUM ('NOT_ASSIGNED', 'THIRD_PARTY', 'SHOPIFY');

-- CreateEnum
CREATE TYPE "LabelStatus" AS ENUM ('NOT_CREATED', 'PENDING', 'CREATED', 'SYNCED_TO_SHOPIFY', 'SYNC_FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "hashed_password" TEXT NOT NULL,
    "display_name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'operator',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "shopify_order_id" TEXT,
    "shopify_order_number" TEXT,
    "shopify_status" TEXT,
    "shopify_fulfill_status" TEXT,
    "shopify_created_at" TIMESTAMP(3),
    "shopify_updated_at" TIMESTAMP(3),
    "shopify_raw_json" JSONB,
    "customer_name" TEXT,
    "customer_email" TEXT,
    "customer_phone" TEXT,
    "shipping_address" JSONB,
    "total_price" DECIMAL(10,2),
    "currency" TEXT DEFAULT 'USD',
    "shipping_method" TEXT,
    "internal_status" "InternalStatus" NOT NULL DEFAULT 'NEW',
    "shipping_route" "ShippingRoute" NOT NULL DEFAULT 'NOT_ASSIGNED',
    "label_status" "LabelStatus" NOT NULL DEFAULT 'NOT_CREATED',
    "routing_timestamp" TIMESTAMP(3),
    "routing_operator" TEXT,
    "tracking_number" TEXT,
    "carrier" TEXT,
    "label_url" TEXT,
    "fulfillment_pushed_at" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assigned_operator" TEXT,
    "sla_deadline" TIMESTAMP(3),
    "is_overdue" BOOLEAN NOT NULL DEFAULT false,
    "delay_flag" BOOLEAN NOT NULL DEFAULT false,
    "hold_reason" TEXT,
    "hold_at" TIMESTAMP(3),
    "cs_note" TEXT,
    "cs_flag" BOOLEAN NOT NULL DEFAULT false,
    "cs_priority" INTEGER NOT NULL DEFAULT 0,
    "cs_issue_type" TEXT,
    "cs_required_action" TEXT,
    "cs_last_contact_time" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shopify_line_item_id" TEXT,
    "title" TEXT NOT NULL,
    "variant_title" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "design_file_url" TEXT,
    "artwork_ref" TEXT,
    "print_size" TEXT,
    "print_notes" TEXT,
    "is_printed" BOOLEAN NOT NULL DEFAULT false,
    "printed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
    "package_number" INTEGER NOT NULL DEFAULT 1,
    "tracking_number" TEXT,
    "carrier" TEXT,
    "service" TEXT,
    "label_status" "LabelStatus" NOT NULL DEFAULT 'NOT_CREATED',
    "label_url" TEXT,
    "label_data" JSONB,
    "shipping_cost" DECIMAL(10,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "estimated_delivery" TIMESTAMP(3),
    "external_shipment_id" TEXT,
    "provider_name" TEXT,
    "provider_raw_json" JSONB,
    "shopify_fulfillment_id" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
    "sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_logs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_logs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "item_ids" TEXT[],
    "printer_name" TEXT,
    "print_config" JSONB,
    "print_result" TEXT,
    "reprint_flag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "print_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "orders_shopify_order_id_key" ON "orders"("shopify_order_id");

-- CreateIndex
CREATE INDEX "orders_internal_status_idx" ON "orders"("internal_status");

-- CreateIndex
CREATE INDEX "orders_shipping_route_idx" ON "orders"("shipping_route");

-- CreateIndex
CREATE INDEX "orders_label_status_idx" ON "orders"("label_status");

-- CreateIndex
CREATE INDEX "orders_is_overdue_idx" ON "orders"("is_overdue");

-- CreateIndex
CREATE INDEX "orders_delay_flag_idx" ON "orders"("delay_flag");

-- CreateIndex
CREATE INDEX "orders_cs_flag_idx" ON "orders"("cs_flag");

-- CreateIndex
CREATE INDEX "orders_sla_deadline_idx" ON "orders"("sla_deadline");

-- CreateIndex
CREATE INDEX "orders_shopify_created_at_idx" ON "orders"("shopify_created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_priority_idx" ON "orders"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_shopify_line_item_id_key" ON "order_items"("shopify_line_item_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_sku_idx" ON "order_items"("sku");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_label_status_idx" ON "shipments"("label_status");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_sync_status_idx" ON "shipments"("sync_status");

-- CreateIndex
CREATE INDEX "order_logs_order_id_idx" ON "order_logs"("order_id");

-- CreateIndex
CREATE INDEX "order_logs_user_id_idx" ON "order_logs"("user_id");

-- CreateIndex
CREATE INDEX "order_logs_action_idx" ON "order_logs"("action");

-- CreateIndex
CREATE INDEX "order_logs_created_at_idx" ON "order_logs"("created_at");

-- CreateIndex
CREATE INDEX "print_logs_order_id_idx" ON "print_logs"("order_id");

-- CreateIndex
CREATE INDEX "print_logs_user_id_idx" ON "print_logs"("user_id");

-- CreateIndex
CREATE INDEX "print_logs_started_at_idx" ON "print_logs"("started_at");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_logs" ADD CONSTRAINT "print_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
