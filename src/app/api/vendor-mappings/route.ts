import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { normalizeVendor } from "@/lib/suppliers/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mappings = await prisma.vendorMapping.findMany({
    orderBy: { vendor: "asc" },
    include: { supplier: { select: { id: true, key: true, name: true, enabled: true } } },
  });

  // Distinct vendors seen on blank order items, to suggest unmapped ones
  const vendorRows = await prisma.orderItem.findMany({
    where: { itemType: "other", vendor: { not: null } },
    select: { vendor: true },
    distinct: ["vendor"],
  });
  const mapped = new Set(mappings.map((m) => m.vendor));
  const unmappedVendors = [...new Set(
    vendorRows.map((r) => normalizeVendor(r.vendor!)).filter((v) => v && !mapped.has(v))
  )].sort();

  return NextResponse.json({ mappings, unmappedVendors });
}

const createSchema = z.object({
  vendor: z.string().min(1),
  supplierId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const vendor = normalizeVendor(parsed.data.vendor);
  const supplier = await prisma.supplier.findUnique({ where: { id: parsed.data.supplierId } });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const mapping = await prisma.vendorMapping.upsert({
    where: { vendor },
    update: { supplierId: supplier.id },
    create: { vendor, supplierId: supplier.id },
    include: { supplier: { select: { id: true, key: true, name: true, enabled: true } } },
  });
  return NextResponse.json({ mapping }, { status: 201 });
}
