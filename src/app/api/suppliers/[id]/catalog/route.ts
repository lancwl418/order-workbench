import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/**
 * GET — a supplier's catalog grouped for the dialog picker:
 * { styles: [{ styleCode, styleName, colors: [{ colorName, sizes: [{ sizeName, productCode }] }] }] }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rows = await prisma.supplierCatalogItem.findMany({
    where: { supplierId: id },
    orderBy: [{ styleCode: "asc" }, { colorName: "asc" }, { createdAt: "asc" }],
  });

  const styleMap = new Map<string, { styleCode: string; styleName: string | null; colors: Map<string, { sizeName: string; productCode: string }[]> }>();
  for (const r of rows) {
    const style = styleMap.get(r.styleCode) ?? { styleCode: r.styleCode, styleName: r.styleName, colors: new Map() };
    const sizes = style.colors.get(r.colorName) ?? [];
    sizes.push({ sizeName: r.sizeName, productCode: r.productCode });
    style.colors.set(r.colorName, sizes);
    styleMap.set(r.styleCode, style);
  }

  return NextResponse.json({
    styles: [...styleMap.values()].map((s) => ({
      styleCode: s.styleCode,
      styleName: s.styleName,
      colors: [...s.colors.entries()].map(([colorName, sizes]) => ({ colorName, sizes })),
    })),
  });
}

const importSchema = z.object({
  items: z
    .array(
      z.object({
        styleCode: z.string().min(1),
        styleName: z.string().optional(),
        colorName: z.string().min(1),
        sizeName: z.string().min(1),
        productCode: z.string().min(1),
      })
    )
    .min(1),
  /** Replace all existing rows for the style codes present in `items`. */
  replaceStyles: z.boolean().default(true),
});

/** POST — bulk import catalog rows (per-style replace by default). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const parsed = importSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { items, replaceStyles } = parsed.data;
  const styleCodes = [...new Set(items.map((i) => i.styleCode))];

  const result = await prisma.$transaction(async (tx) => {
    if (replaceStyles) {
      await tx.supplierCatalogItem.deleteMany({
        where: { supplierId: id, styleCode: { in: styleCodes } },
      });
    }
    const created = await tx.supplierCatalogItem.createMany({
      data: items.map((i) => ({
        supplierId: id,
        styleCode: i.styleCode,
        styleName: i.styleName ?? null,
        colorName: i.colorName,
        sizeName: i.sizeName,
        productCode: i.productCode,
      })),
      skipDuplicates: true,
    });
    return created.count;
  }, { maxWait: 10_000, timeout: 30_000 });

  return NextResponse.json({ imported: result, styles: styleCodes });
}
