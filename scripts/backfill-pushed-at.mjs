#!/usr/bin/env node
/**
 * Backfill SupplierPush.pushedAt for pushes whose factory status proves the
 * order reached the factory (factory audit → closed, 4..13) but pushedAt was
 * never recorded — the operator pushed from the supplier console instead of
 * the workbench. The status sync now sets this going forward; this fixes
 * terminal rows the sync no longer visits. Idempotent.
 *
 *   node scripts/backfill-pushed-at.mjs
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Pooler connection (same as the app) — the direct DB connection isn't
// always reachable from the operator's machine.
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$executeRawUnsafe(`
    UPDATE supplier_pushes
    SET pushed_at = COALESCE(status_synced_at, NOW())
    WHERE pushed_at IS NULL
      AND order_status BETWEEN 4 AND 13
  `);
  console.log(`Backfilled pushedAt on ${result} supplier pushes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
