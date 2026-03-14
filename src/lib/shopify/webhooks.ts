import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { transformShopifyOrder } from "./orders";
import type { ShopifyOrder, ShopifyFulfillment } from "./types";
import { onShipmentUpdated } from "@/lib/exceptions/realtime";

/**
 * Verify the HMAC signature of an incoming Shopify webhook request.
 * Returns true if the signature is valid.
 */
export function verifyWebhook(
  rawBody: string,
  hmacHeader: string
): boolean {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmacHeader)
  );
}

/**
 * Route incoming Shopify webhook events to the appropriate handler.
 */
export async function processShopifyWebhook(
  topic: string,
  payload: unknown
): Promise<{ action: string; orderId?: string }> {
  switch (topic) {
    case "orders/create":
      return handleOrderCreate(payload as ShopifyOrder);
    case "orders/updated":
      return handleOrderUpdated(payload as ShopifyOrder);
    case "fulfillments/create":
    case "fulfillments/update":
      return handleFulfillmentUpsert(
        topic,
        payload as ShopifyFulfillment & { order_id: number }
      );
    default:
      return { action: "ignored", orderId: undefined };
  }
}

/**
 * Handle orders/create webhook: create the order in our DB.
 */
async function handleOrderCreate(
  shopifyOrder: ShopifyOrder
): Promise<{ action: string; orderId: string }> {
  const { order: orderData, items, fulfillments } = transformShopifyOrder(shopifyOrder);

  const latestFulfillment = fulfillments[0] || null;
  const trackingFields = latestFulfillment
    ? { trackingNumber: latestFulfillment.trackingNumber, carrier: latestFulfillment.carrier }
    : {};

  // Auto-detect print files → set printStatus to READY
  const hasDesignFiles = items.some((item) => item.designFileUrl);
  const printFields = hasDesignFiles ? { printStatus: "READY" as const } : {};

  const upsertedOrder = await prisma.order.upsert({
    where: { shopifyOrderId: orderData.shopifyOrderId },
    create: { ...orderData, ...trackingFields, ...printFields },
    update: {
      shopifyStatus: orderData.shopifyStatus,
      shopifyFulfillStatus: orderData.shopifyFulfillStatus,
      shopifyUpdatedAt: orderData.shopifyUpdatedAt,
      shopifyRawJson: orderData.shopifyRawJson,
      customerName: orderData.customerName,
      customerEmail: orderData.customerEmail,
      customerPhone: orderData.customerPhone,
      shippingAddress: orderData.shippingAddress,
      totalPrice: orderData.totalPrice,
      currency: orderData.currency,
      shippingMethod: orderData.shippingMethod,
      ...trackingFields,
    },
  });

  for (const item of items) {
    await prisma.orderItem.upsert({
      where: { shopifyLineItemId: item.shopifyLineItemId },
      create: { ...item, orderId: upsertedOrder.id },
      update: { title: item.title, variantTitle: item.variantTitle, sku: item.sku, quantity: item.quantity, price: item.price },
    });
  }

  for (const f of fulfillments) {
    await prisma.shipment.upsert({
      where: { shopifyFulfillmentId: f.shopifyFulfillmentId },
      create: {
        orderId: upsertedOrder.id, sourceType: "SHOPIFY", trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl, carrier: f.carrier, shopifyFulfillmentId: f.shopifyFulfillmentId,
        syncStatus: "SYNCED", status: f.shipmentStatus || f.status, shippedAt: f.shippedAt,
      },
      update: { trackingNumber: f.trackingNumber, trackingUrl: f.trackingUrl, carrier: f.carrier, status: f.shipmentStatus || f.status },
    });
  }

  await prisma.orderLog.create({
    data: {
      orderId: upsertedOrder.id,
      action: "synced",
      toValue: "webhook_create",
      message: `Order ${orderData.shopifyOrderNumber} received via webhook (orders/create)`,
      metadata: { source: "webhook", topic: "orders/create", shopifyOrderId: orderData.shopifyOrderId },
    },
  });

  return { action: "created", orderId: upsertedOrder.id };
}

/**
 * Handle orders/updated webhook: update the existing order in our DB.
 */
async function handleOrderUpdated(
  shopifyOrder: ShopifyOrder
): Promise<{ action: string; orderId: string }> {
  const { order: orderData, items, fulfillments } = transformShopifyOrder(shopifyOrder);

  const latestFulfillment = fulfillments[0] || null;
  const trackingFields = latestFulfillment
    ? { trackingNumber: latestFulfillment.trackingNumber, carrier: latestFulfillment.carrier }
    : {};

  const upsertedOrder = await prisma.order.upsert({
    where: { shopifyOrderId: orderData.shopifyOrderId },
    create: { ...orderData, ...trackingFields },
    update: {
      shopifyStatus: orderData.shopifyStatus,
      shopifyFulfillStatus: orderData.shopifyFulfillStatus,
      shopifyUpdatedAt: orderData.shopifyUpdatedAt,
      shopifyRawJson: orderData.shopifyRawJson,
      customerName: orderData.customerName,
      customerEmail: orderData.customerEmail,
      customerPhone: orderData.customerPhone,
      shippingAddress: orderData.shippingAddress,
      totalPrice: orderData.totalPrice,
      currency: orderData.currency,
      shippingMethod: orderData.shippingMethod,
      internalStatus: orderData.internalStatus,
      ...trackingFields,
    },
  });

  for (const item of items) {
    await prisma.orderItem.upsert({
      where: { shopifyLineItemId: item.shopifyLineItemId },
      create: { ...item, orderId: upsertedOrder.id },
      update: { title: item.title, variantTitle: item.variantTitle, sku: item.sku, quantity: item.quantity, price: item.price },
    });
  }

  for (const f of fulfillments) {
    await prisma.shipment.upsert({
      where: { shopifyFulfillmentId: f.shopifyFulfillmentId },
      create: {
        orderId: upsertedOrder.id, sourceType: "SHOPIFY", trackingNumber: f.trackingNumber,
        trackingUrl: f.trackingUrl, carrier: f.carrier, shopifyFulfillmentId: f.shopifyFulfillmentId,
        syncStatus: "SYNCED", status: f.shipmentStatus || f.status, shippedAt: f.shippedAt,
      },
      update: { trackingNumber: f.trackingNumber, trackingUrl: f.trackingUrl, carrier: f.carrier, status: f.shipmentStatus || f.status },
    });
  }

  await prisma.orderLog.create({
    data: {
      orderId: upsertedOrder.id,
      action: "synced",
      toValue: "webhook_update",
      message: `Order ${orderData.shopifyOrderNumber} updated via webhook (orders/updated)`,
      metadata: { source: "webhook", topic: "orders/updated", shopifyOrderId: orderData.shopifyOrderId },
    },
  });

  return { action: "updated", orderId: upsertedOrder.id };
}

/**
 * Handle fulfillments/create and fulfillments/update webhooks.
 * Upserts the shipment record and updates tracking + transit status.
 */
async function handleFulfillmentUpsert(
  topic: string,
  payload: ShopifyFulfillment & { order_id: number }
): Promise<{ action: string; orderId?: string }> {
  const shopifyOrderId = String(payload.order_id);

  const order = await prisma.order.findUnique({
    where: { shopifyOrderId },
  });

  if (!order) {
    return { action: "skipped_no_order" };
  }

  const trackingNumber =
    payload.tracking_number || payload.tracking_numbers?.[0] || null;
  const carrier = payload.tracking_company || null;
  const trackingUrl =
    payload.tracking_url || payload.tracking_urls?.[0] || null;
  const shipmentStatus = payload.shipment_status || null;
  const fulfillmentId = String(payload.id);

  // Map shipment/fulfillment status → order internalStatus
  let newInternalStatus: string | undefined;
  if (shipmentStatus === "delivered") {
    newInternalStatus = "DELIVERED";
  } else if (shipmentStatus === "in_transit" || shipmentStatus === "out_for_delivery") {
    newInternalStatus = "SHIPPED";
  } else if (shipmentStatus === "failure" || shipmentStatus === "attempted_delivery") {
    newInternalStatus = "DELAYED";
  } else if (trackingNumber && (!shipmentStatus || shipmentStatus === "label_printed" || shipmentStatus === "label_purchased" || shipmentStatus === "confirmed")) {
    newInternalStatus = "LABEL_CREATED";
  } else if (payload.status === "success" && trackingNumber) {
    newInternalStatus = "LABEL_CREATED";
  }

  // Print status → DONE only when actually in transit, delivered, or delayed
  const printDoneStatuses = ["SHIPPED", "DELIVERED", "DELAYED"];
  const newPrintStatus = newInternalStatus && printDoneStatuses.includes(newInternalStatus) ? "DONE" : undefined;

  // Update order-level fields
  await prisma.order.update({
    where: { id: order.id },
    data: {
      shopifyFulfillStatus: payload.status,
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(carrier ? { carrier } : {}),
      ...(newInternalStatus ? { internalStatus: newInternalStatus as never } : {}),
      ...(newPrintStatus ? { printStatus: newPrintStatus as never } : {}),
    },
  });

  // Upsert shipment record
  if (trackingNumber || carrier) {
    const deliveredAt =
      shipmentStatus === "delivered" ? new Date() : undefined;

    const upsertedShipment = await prisma.shipment.upsert({
      where: { shopifyFulfillmentId: fulfillmentId },
      create: {
        orderId: order.id,
        sourceType: "SHOPIFY",
        trackingNumber,
        trackingUrl,
        carrier,
        shopifyFulfillmentId: fulfillmentId,
        syncStatus: "SYNCED",
        status: shipmentStatus || "shipped",
        shippedAt: new Date(payload.created_at),
        ...(deliveredAt ? { deliveredAt } : {}),
      },
      update: {
        trackingNumber,
        trackingUrl,
        carrier,
        status: shipmentStatus || "shipped",
        ...(deliveredAt ? { deliveredAt } : {}),
      },
    });

    // Real-time exception detection/resolution
    onShipmentUpdated(upsertedShipment.id).catch(() => {});
  }

  await prisma.orderLog.create({
    data: {
      orderId: order.id,
      action:
        topic === "fulfillments/create"
          ? "fulfillment_received"
          : "tracking_updated",
      toValue: shipmentStatus || payload.status,
      message:
        topic === "fulfillments/create"
          ? `Fulfillment created (tracking: ${trackingNumber || "none"}, carrier: ${carrier || "none"})`
          : `Tracking updated: ${trackingNumber || "none"} [${shipmentStatus || payload.status}]`,
      metadata: {
        source: "webhook",
        topic,
        shopifyFulfillmentId: fulfillmentId,
        trackingNumber,
        carrier,
        shipmentStatus,
      },
    },
  });

  return { action: "fulfillment_upserted", orderId: order.id };
}
