#!/usr/bin/env node
/**
 * Merge duplicate shipments: a Shopify-sourced shipment whose tracking number
 * matches a local (OMS / factory) shipment on the same order.
 *
 * Happens when an operator keys an OMS tracking into Shopify by hand before
 * our sync links the OMS shipment — Shopify's webhook then created a second
 * row. The fix in lib/shipments/from-shopify-fulfillment.ts stops new ones;
 * this repairs rows created before that.
 *
 * Usage:
 *   node scripts/merge-duplicate-shipments.mjs            # dry run
 *   node scripts/merge-duplicate-shipments.mjs --apply    # write changes
 *   node scripts/merge-duplicate-shipments.mjs --order '#4436' [--apply]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const apply = process.argv.includes("--apply");
const orderArgIdx = process.argv.indexOf("--order");
const onlyOrder = orderArgIdx > -1 ? process.argv[orderArgIdx + 1] : null;

function trackingsMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 8 || b.length < 8) return false;
  return a.includes(b) || b.includes(a);
}

async function main() {
  const orders = await prisma.order.findMany({
    where: onlyOrder ? { shopifyOrderNumber: onlyOrder } : {},
    select: {
      id: true,
      shopifyOrderNumber: true,
      shipments: { orderBy: { createdAt: "asc" } },
    },
  });

  let merged = 0;
  for (const order of orders) {
    const shopifyRows = order.shipments.filter(
      (s) => s.sourceType === "SHOPIFY" && s.trackingNumber
    );
    for (const dup of shopifyRows) {
      const keep = order.shipments.find(
        (s) =>
          s.id !== dup.id &&
          s.sourceType !== "SHOPIFY" &&
          !s.shopifyFulfillmentId &&
          trackingsMatch(s.trackingNumber, dup.trackingNumber)
      );
      if (!keep) continue;

      console.log(
        `${order.shopifyOrderNumber}: merge SHOPIFY ${dup.id} (${dup.carrier} ${dup.trackingNumber}) ` +
          `into ${keep.providerName ?? keep.sourceType} ${keep.id} (${keep.carrier})`
      );
      merged++;
      if (!apply) continue;

      await prisma.$transaction([
        prisma.orderException.updateMany({
          where: { shipmentId: dup.id },
          data: { shipmentId: keep.id },
        }),
        prisma.shipment.delete({ where: { id: dup.id } }),
        prisma.shipment.update({
          where: { id: keep.id },
          data: {
            shopifyFulfillmentId: dup.shopifyFulfillmentId,
            syncStatus: "SYNCED",
            syncError: null,
            labelStatus: "SYNCED_TO_SHOPIFY",
            status: dup.status,
            trackingUrl: keep.trackingUrl ?? dup.trackingUrl,
            shippedAt: keep.shippedAt ?? dup.shippedAt,
            deliveredAt: keep.deliveredAt ?? dup.deliveredAt,
            shopifyFulfillmentOrderId:
              keep.shopifyFulfillmentOrderId ?? dup.shopifyFulfillmentOrderId,
          },
        }),
      ]);
    }
  }

  console.log(`\n${merged} duplicate(s) ${apply ? "merged" : "found (dry run — pass --apply to merge)"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
