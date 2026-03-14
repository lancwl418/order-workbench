#!/usr/bin/env node
/**
 * Reset order statuses based on actual Shopify + shipment data.
 *
 * Order status directly reflects shipping lifecycle:
 * - OPEN: unfulfilled
 * - LABEL_CREATED: has tracking but not yet in transit
 * - SHIPPED: in transit / out for delivery
 * - DELIVERED: delivered
 * - DELAYED: delivery failure / attempted delivery
 * - CANCELLED: cancelled / refunded
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

async function main() {
  const orders = await prisma.order.findMany({
    include: {
      orderItems: true,
      shipments: true,
    },
  });

  console.log(`Total orders: ${orders.length}\n`);

  const stats = { cancelled: 0, open: 0, label_created: 0, shipped: 0, delivered: 0, delayed: 0, print_done: 0 };

  for (const order of orders) {
    const shopifyStatus = order.shopifyStatus?.toLowerCase() || "";
    const fulfillStatus = order.shopifyFulfillStatus?.toLowerCase() || "";
    const isCancelled = shopifyStatus === "refunded" || shopifyStatus === "voided" || order.shopifyRawJson?.cancelled_at;

    // Check shipment statuses
    const shipments = order.shipments;
    const hasDelivered = shipments.some((s) => s.status === "delivered");
    const hasInTransit = shipments.some((s) => ["shipped", "in_transit", "out_for_delivery"].includes(s.status));
    const hasTracking = shipments.some((s) => s.trackingNumber);
    const hasFailure = shipments.some((s) => ["failure", "attempted_delivery"].includes(s.status));

    let newStatus;
    let newPrintStatus;

    const hasPrintFiles = order.orderItems.some((i) => i.designFileUrl);
    // Print workflow statuses that should be preserved (not overwritten)
    const printWorkflowStatuses = ["IN_QUEUE", "GROUPED"];

    if (isCancelled) {
      newStatus = "CANCELLED";
      newPrintStatus = "NONE";
      stats.cancelled++;
    } else if (fulfillStatus === "fulfilled" || fulfillStatus === "partial") {
      if (hasDelivered) {
        newStatus = "DELIVERED";
        newPrintStatus = hasPrintFiles ? "DONE" : "NONE";
        stats.delivered++;
        if (hasPrintFiles) stats.print_done++;
      } else if (hasFailure) {
        newStatus = "DELAYED";
        newPrintStatus = hasPrintFiles ? "DONE" : "NONE";
        stats.delayed++;
        if (hasPrintFiles) stats.print_done++;
      } else if (hasInTransit) {
        newStatus = "SHIPPED";
        newPrintStatus = hasPrintFiles ? "DONE" : "NONE";
        stats.shipped++;
        if (hasPrintFiles) stats.print_done++;
      } else if (hasTracking) {
        // Label created but not yet in transit → print is NOT done
        newStatus = "LABEL_CREATED";
        if (printWorkflowStatuses.includes(order.printStatus)) {
          newPrintStatus = order.printStatus;
        } else {
          newPrintStatus = hasPrintFiles ? "READY" : "NONE";
        }
        stats.label_created++;
      } else {
        // Fulfilled but no shipment data → assume shipped
        newStatus = "SHIPPED";
        newPrintStatus = hasPrintFiles ? "DONE" : "NONE";
        stats.shipped++;
        if (hasPrintFiles) stats.print_done++;
      }
    } else {
      newStatus = "OPEN";
      if (printWorkflowStatuses.includes(order.printStatus)) {
        newPrintStatus = order.printStatus;
      } else {
        newPrintStatus = hasPrintFiles ? "READY" : "NONE";
      }
      stats.open++;
    }

    const updates = {};
    if (order.internalStatus !== newStatus) updates.internalStatus = newStatus;
    if (order.printStatus !== newPrintStatus) updates.printStatus = newPrintStatus;

    if (Object.keys(updates).length > 0) {
      await prisma.order.update({
        where: { id: order.id },
        data: updates,
      });
      console.log(
        `${order.shopifyOrderNumber} | status: ${order.internalStatus} → ${newStatus} | print: ${order.printStatus} → ${newPrintStatus}`
      );
    }

    if (newPrintStatus === "DONE") {
      const unprintedItems = order.orderItems.filter((i) => !i.isPrinted && i.designFileUrl);
      if (unprintedItems.length > 0) {
        await prisma.orderItem.updateMany({
          where: { orderId: order.id, isPrinted: false },
          data: { isPrinted: true, printedAt: new Date() },
        });
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Open: ${stats.open}`);
  console.log(`Label Created: ${stats.label_created}`);
  console.log(`Shipped: ${stats.shipped}`);
  console.log(`Delivered: ${stats.delivered}`);
  console.log(`Delayed: ${stats.delayed}`);
  console.log(`Cancelled: ${stats.cancelled}`);
  console.log(`Print Done: ${stats.print_done}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
