#!/usr/bin/env npx tsx
/**
 * One-off backfill for OrderItem.soldPerSheet (2026-11-17).
 *
 * Orders ingested before the flag existed re-classify through the normal
 * refresh path (fetches the Shopify order, maps product ids), so only the
 * two sold-per-sheet products get the flag. Scoped to orders that are not
 * in a terminal status — delivered/cancelled orders self-heal if anyone
 * ever reopens their print files.
 *
 * Pass --dry to list the orders without touching them.
 */
import "dotenv/config";
import { InternalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshPrintFileUrls } from "@/lib/shopify/refresh-print-urls";

const DRY = process.argv.includes("--dry");
const TERMINAL: InternalStatus[] = [
  InternalStatus.DELIVERED,
  InternalStatus.CANCELLED,
  InternalStatus.SHIPPED,
  InternalStatus.PICKED_UP,
];

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      internalStatus: { notIn: TERMINAL },
      orderItems: { some: { itemType: "gangsheet" } },
    },
    select: { id: true, shopifyOrderNumber: true, internalStatus: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`${orders.length} active orders with gangsheet items${DRY ? " (dry run)" : ""}`);

  for (const o of orders) {
    if (DRY) {
      console.log(`  would refresh ${o.shopifyOrderNumber} [${o.internalStatus}]`);
      continue;
    }
    const updated = await refreshPrintFileUrls(o.id);
    console.log(`  ${o.shopifyOrderNumber} [${o.internalStatus}]: ${updated} item(s) updated`);
  }
}

main().finally(() => prisma.$disconnect());
