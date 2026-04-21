import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderItems: { select: { id: true, sku: true, variantTitle: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const lookups = order.orderItems.filter((i) => i.sku);
  if (lookups.length === 0) {
    return NextResponse.json({ mappings: {} });
  }

  const rows = await prisma.skuMapping.findMany({
    where: {
      OR: lookups.map((i) => ({
        ourSku: i.sku!,
        variantTitle: i.variantTitle ?? "",
      })),
    },
  });

  const mappings: Record<string, {
    factorySku: string;
    factorySize: string | null;
    factoryColor: string | null;
    factoryStyle: string | null;
    factoryCraftType: number | null;
  }> = {};

  for (const item of order.orderItems) {
    const match = rows.find(
      (r) => r.ourSku === item.sku && r.variantTitle === (item.variantTitle ?? "")
    );
    if (match) {
      mappings[item.id] = {
        factorySku: match.factorySku,
        factorySize: match.factorySize,
        factoryColor: match.factoryColor,
        factoryStyle: match.factoryStyle,
        factoryCraftType: match.factoryCraftType,
      };
    }
  }

  return NextResponse.json({ mappings });
}
