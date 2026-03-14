import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchOrders, transformShopifyOrder } from "@/lib/shopify/orders";

/**
 * POST /api/orders/sync
 *
 * Triggers a manual sync of orders from Shopify.
 * Fetches recent orders, transforms them, and upserts into the database.
 * Also syncs fulfillment/tracking data into shipments table.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      status,
      limit,
      createdAtMin,
      updatedAtMin,
    } = body as {
      status?: string;
      limit?: number;
      createdAtMin?: string;
      updatedAtMin?: string;
    };

    const shopifyOrders = await fetchOrders({
      status,
      limit: limit || 250,
      createdAtMin,
      updatedAtMin,
      fetchAll: true,
    });

    let created = 0;
    let updated = 0;
    const errors: Array<{ shopifyOrderId: string; error: string }> = [];

    for (const shopifyOrder of shopifyOrders) {
      try {
        const { order: orderData, items, fulfillments } =
          transformShopifyOrder(shopifyOrder);

        const existingOrder = await prisma.order.findUnique({
          where: { shopifyOrderId: orderData.shopifyOrderId },
        });

        const isNew = !existingOrder;

        // Denormalize tracking from the latest fulfillment
        const latestFulfillment = fulfillments[0] || null;
        const trackingFields = latestFulfillment
          ? {
              trackingNumber: latestFulfillment.trackingNumber,
              carrier: latestFulfillment.carrier,
            }
          : {};

        // Auto-flag CS orders based on tags
        const isCsOrder = orderData.tags.some(
          (t) => t.toLowerCase() === "customerservice"
        );
        const csFields = isCsOrder
          ? { csFlag: true, internalStatus: "REVIEW" as const }
          : {};

        // Auto-detect print files to set printStatus
        const hasDesignFiles = items.some((item) => item.designFileUrl);
        const printFields = isNew && hasDesignFiles
          ? { printStatus: "READY" as const }
          : {};

        const upsertedOrder = await prisma.order.upsert({
          where: { shopifyOrderId: orderData.shopifyOrderId },
          create: {
            ...orderData,
            ...trackingFields,
            ...csFields,
            ...printFields,
          },
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
            tags: orderData.tags,
            notes: orderData.notes,
            ...trackingFields,
            ...csFields,
          },
        });

        // Upsert line items
        for (const item of items) {
          await prisma.orderItem.upsert({
            where: { shopifyLineItemId: item.shopifyLineItemId },
            create: {
              ...item,
              orderId: upsertedOrder.id,
            },
            update: {
              title: item.title,
              variantTitle: item.variantTitle,
              sku: item.sku,
              quantity: item.quantity,
              price: item.price,
              designFileUrl: item.designFileUrl,
            },
          });
        }

        // Upsert shipments from fulfillments (tracking data)
        for (const f of fulfillments) {
          await prisma.shipment.upsert({
            where: { shopifyFulfillmentId: f.shopifyFulfillmentId },
            create: {
              orderId: upsertedOrder.id,
              sourceType: "SHOPIFY",
              trackingNumber: f.trackingNumber,
              trackingUrl: f.trackingUrl,
              carrier: f.carrier,
              shopifyFulfillmentId: f.shopifyFulfillmentId,
              syncStatus: "SYNCED",
              status: f.shipmentStatus || f.status,
              shippedAt: f.shippedAt,
            },
            update: {
              trackingNumber: f.trackingNumber,
              trackingUrl: f.trackingUrl,
              carrier: f.carrier,
              status: f.shipmentStatus || f.status,
            },
          });
        }

        await prisma.orderLog.create({
          data: {
            orderId: upsertedOrder.id,
            userId: session.user?.id,
            action: "synced",
            toValue: isNew ? "created" : "updated",
            message: isNew
              ? `Order ${orderData.shopifyOrderNumber} synced from Shopify (new)${latestFulfillment ? ` [tracking: ${latestFulfillment.trackingNumber}]` : ""}`
              : `Order ${orderData.shopifyOrderNumber} synced from Shopify (updated)`,
            metadata: {
              shopifyOrderId: orderData.shopifyOrderId,
              shopifyStatus: orderData.shopifyStatus,
              shopifyFulfillStatus: orderData.shopifyFulfillStatus,
            },
          },
        });

        if (isNew) {
          created++;
        } else {
          updated++;
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        errors.push({
          shopifyOrderId: String(shopifyOrder.id),
          error: errorMessage,
        });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        fetched: shopifyOrders.length,
        created,
        updated,
        errors: errors.length,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error("Shopify sync failed:", errorMessage);
    return NextResponse.json(
      { error: "Sync failed", details: errorMessage },
      { status: 500 }
    );
  }
}
