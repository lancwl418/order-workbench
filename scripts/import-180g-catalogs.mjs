#!/usr/bin/env node
/**
 * Import the 180g t-shirt catalogs:
 * - linmiao T001 (from 5.26-LM货盘资料.xlsx — active colors only; the black
 *   2XL/3XL codes are "T001-BK01-2L"/"-3L" exactly as in the factory sheet)
 * - jjspromo A2 (from the JJS mapping table: A2-{Color}-{Size})
 * Idempotent: replaces each style's rows on re-run.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];

// linmiao T001: colorName -> per-size product codes (sheet-exact)
const T001_COLORS = {
  "BK01": ["T001-BK01-S", "T001-BK01-M", "T001-BK01-L", "T001-BK01-XL", "T001-BK01-2L", "T001-BK01-3L"],
  "WH01": SIZES.map((s) => `T001-WH01-${s}`),
  "Dark Blue": SIZES.map((s) => `T001-Dark Blue-${s}`),
  "Red": SIZES.map((s) => `T001-Red-${s}`),
  "Pink": SIZES.map((s) => `T001-Pink-${s}`),
  "DKGrey": SIZES.map((s) => `T001-DKGrey-${s}`),
  "Brown": SIZES.map((s) => `T001-Brown-${s}`),
  "Bamboo green": SIZES.map((s) => `T001-Bamboo green-${s}`),
};

const A2_COLORS = [
  "Black", "White", "Red", "Yellow Haze", "Heather Grey",
  "Pink", "Navy", "Military", "Apricot", "Iron Grey",
];

async function importCatalog(supplierKey, styleCode, styleName, rows) {
  const supplier = await prisma.supplier.findUnique({ where: { key: supplierKey } });
  if (!supplier) throw new Error(`Supplier ${supplierKey} not found — run the seed first`);
  await prisma.supplierCatalogItem.deleteMany({
    where: { supplierId: supplier.id, styleCode },
  });
  await prisma.supplierCatalogItem.createMany({
    data: rows.map((r) => ({ supplierId: supplier.id, styleCode, styleName, ...r })),
    skipDuplicates: true,
  });
  console.log(`${supplierKey} ${styleCode}: imported ${rows.length} rows`);
}

async function main() {
  const t001Rows = Object.entries(T001_COLORS).flatMap(([colorName, codes]) =>
    codes.map((productCode, i) => ({ colorName, sizeName: SIZES[i], productCode }))
  );
  await importCatalog("linmiao", "T001", "180G 纯棉T恤成人款", t001Rows);

  const a2Rows = A2_COLORS.flatMap((colorName) =>
    SIZES.map((sizeName) => ({ colorName, sizeName, productCode: `A2-${colorName}-${sizeName}` }))
  );
  await importCatalog("jjspromo", "A2", "180g T-shirt", a2Rows);
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
