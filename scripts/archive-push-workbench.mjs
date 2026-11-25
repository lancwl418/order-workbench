#!/usr/bin/env node
/**
 * Bulk-archive orders from the Blanks / Printed Apparel push workbench:
 * sets orders.push_archived_at for orders created before a cutoff date.
 * Only the push workbench pages read this flag — nothing else changes.
 * Idempotent: already-archived orders are left untouched (their original
 * archive time is kept), and the column DDL is applied IF NOT EXISTS.
 *
 *   node scripts/archive-push-workbench.mjs 2026-11-01
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const cutoffArg = process.argv[2];
if (!cutoffArg || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffArg)) {
  console.error("Usage: node scripts/archive-push-workbench.mjs YYYY-MM-DD");
  process.exit(1);
}
const cutoff = new Date(`${cutoffArg}T00:00:00Z`);

// Pooler connection (same as the app) — the direct DB connection isn't
// always reachable from the operator's machine.
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "push_archived_at" TIMESTAMP(3)`
  );

  const candidates = await prisma.order.count({
    where: { pushArchivedAt: null, shopifyCreatedAt: { lt: cutoff } },
  });
  const result = await prisma.order.updateMany({
    where: { pushArchivedAt: null, shopifyCreatedAt: { lt: cutoff } },
    data: { pushArchivedAt: new Date() },
  });
  console.log(
    `Archived ${result.count}/${candidates} orders created before ${cutoffArg}.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
