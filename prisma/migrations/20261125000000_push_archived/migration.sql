-- Orders hidden from the Blanks/Printed Apparel push workbench (don't need
-- factory pushing). IF NOT EXISTS: the column may be pre-applied through the
-- pooler when the direct DB connection isn't reachable from the operator's
-- machine.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "push_archived_at" TIMESTAMP(3);
