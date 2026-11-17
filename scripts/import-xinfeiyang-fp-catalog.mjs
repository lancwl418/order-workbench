#!/usr/bin/env node
/**
 * Xinfeiyang (FP ERP) catalog + SKU mappings, from the DIGIPRINT 货盘表
 * (Feishu, read 2026-11-16). FP product codes are {style}-{colorCode}-{size}
 * with sizes spelled XXL/XXXL — not the Shopify "{style}-{Color}-2XL" form
 * the old riin-era mappings carried.
 *
 * - Catalog: every colour x size the sheet lists for the styles we sell.
 * - Mappings: only Shopify variants that have appeared in orders, and only
 *   where the colour match is confirmed. Held back (see HOLD): DG502 "red"
 *   (sheet only has RE01 = rose red) and DG203 (not in the sheet — out of
 *   stock at Xinfeiyang, do not push).
 *
 * Idempotent. Pass --dry to print without writing.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const DRY = process.argv.includes("--dry");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

const range = (from, to) => {
  const all = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL", "XXXXXL"];
  return all.slice(all.indexOf(from), all.indexOf(to) + 1);
};

const STYLES = {
  DG505: {
    name: "180g男士纯棉长袖",
    sizes: range("XS", "XXXL"),
    colors: ["BL01", "WH01", "AP01", "NAVY", "RED", "ATHLETIC HEATHER", "DARK GREY HEATHER"],
  },
  DG502: { name: "DG502", sizes: range("S", "XXL"), colors: ["BL01", "WH01", "GR02", "VT01", "RE01"] },
  VS004: {
    name: "180G V领彩棉背心",
    sizes: range("S", "XXXXXL"),
    colors: ["WHITE", "LIGHT BLUE", "PURPLE", "ROSE RED", "DAISY", "DARK GREY"],
  },
  DG004: {
    name: "DG004",
    sizes: range("S", "XXXXXL"),
    colors: ["BL01", "GR03", "AP01", "CF01", "BU01", "GN01", "VT01", "RE01"],
  },
  DG013: { name: "DG013", sizes: range("S", "XXXL"), colors: ["BL01", "GR02", "GN01", "VT01", "RE01", "NG01"] },
};

// Shopify colour (lower-cased) -> sheet colour code, per style.
const COLOR_MAP = {
  DG505: {
    black: "BL01", white: "WH01", apricot: "AP01", navy: "NAVY", red: "RED",
    "light gray": "ATHLETIC HEATHER", dkgrey: "DARK GREY HEATHER",
  },
  DG502: { grey: "GR02", purple: "VT01" },
  VS004: { dkgrey: "DARK GREY", "rose red": "ROSE RED" },
  DG004: { apricot: "AP01", coffee: "CF01", green: "GN01" },
  DG013: { "neon green": "NG01" },
};
const SIZE_MAP = { "2XL": "XXL", "3XL": "XXXL", "4XL": "XXXXL", "5XL": "XXXXXL" };

async function main() {
  const supplier = await prisma.supplier.findUnique({ where: { key: "xinfeiyang" } });
  if (!supplier) throw new Error("Supplier xinfeiyang not found");

  for (const [styleCode, s] of Object.entries(STYLES)) {
    const rows = s.colors.flatMap((colorName) =>
      s.sizes.map((sizeName) => ({
        supplierId: supplier.id, styleCode, styleName: s.name, colorName, sizeName,
        productCode: `${styleCode}-${colorName}-${sizeName}`,
      }))
    );
    console.log(`catalog ${styleCode}: ${rows.length} rows`);
    if (!DRY) {
      await prisma.supplierCatalogItem.deleteMany({ where: { supplierId: supplier.id, styleCode } });
      await prisma.supplierCatalogItem.createMany({ data: rows, skipDuplicates: true });
    }
  }

  const variants = await prisma.$queryRawUnsafe(
    `select distinct sku, variant_title from order_items
     where lower(vendor) in ('xinfeiyang','鑫飞扬美履') and sku is not null order by 1`
  );
  const held = [];
  for (const v of variants) {
    const [style, ...rest] = v.sku.split("-");
    const size = rest.pop();
    const color = rest.join("-");
    const code = COLOR_MAP[style]?.[color.toLowerCase()];
    const fpSize = SIZE_MAP[size] ?? size;
    if (!code || !STYLES[style].sizes.includes(fpSize)) {
      held.push(v.sku);
      continue;
    }
    const factorySku = `${style}-${code}-${fpSize}`;
    console.log(`map ${v.sku} (${v.variant_title}) -> ${factorySku}`);
    if (DRY) continue;
    const data = { factorySku, factoryStyle: style, factoryColor: code, factorySize: fpSize };
    const existing = await prisma.skuMapping.findFirst({
      where: { ourSku: v.sku, variantTitle: v.variant_title ?? "", supplierId: supplier.id },
    });
    if (existing) await prisma.skuMapping.update({ where: { id: existing.id }, data });
    else {
      await prisma.skuMapping.create({
        data: { ourSku: v.sku, variantTitle: v.variant_title ?? "", supplierId: supplier.id, ...data },
      });
    }
  }
  console.log(`HOLD (not mapped): ${held.join(", ") || "none"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
