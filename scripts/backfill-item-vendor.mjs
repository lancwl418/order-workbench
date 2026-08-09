#!/usr/bin/env node
/**
 * Backfill OrderItem.vendor from each order's stored Shopify raw JSON
 * (shopifyRawJson.line_items[].vendor). Idempotent: only touches items
 * whose vendor is still null. Run once after deploying the blanks-push
 * schema, against the production DB:
 *
 *   node scripts/backfill-item-vendor.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

async function main() {
  const BATCH = 200;
  let cursor = undefined;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const orders = await prisma.order.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        shopifyRawJson: true,
        orderItems: { select: { id: true, shopifyLineItemId: true, vendor: true } },
      },
    });
    if (orders.length === 0) break;
    cursor = orders[orders.length - 1].id;

    for (const order of orders) {
      scanned++;
      const lineItems = order.shopifyRawJson?.line_items;
      if (!Array.isArray(lineItems)) continue;

      const vendorByLineItemId = new Map();
      for (const li of lineItems) {
        if (li && li.id != null && li.vendor) {
          vendorByLineItemId.set(String(li.id), String(li.vendor));
        }
      }
      if (vendorByLineItemId.size === 0) continue;

      for (const item of order.orderItems) {
        if (item.vendor || !item.shopifyLineItemId) continue;
        const vendor = vendorByLineItemId.get(item.shopifyLineItemId);
        if (!vendor) continue;
        await prisma.orderItem.update({
          where: { id: item.id },
          data: { vendor },
        });
        updated++;
      }
    }
    console.log(`Scanned ${scanned} orders, updated ${updated} items so far...`);
  }

  console.log(`Done. Scanned ${scanned} orders, backfilled vendor on ${updated} items.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
