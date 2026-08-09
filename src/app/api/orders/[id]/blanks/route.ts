import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSupplierGroups } from "@/lib/suppliers/push-service";
import { normalizeVendor } from "@/lib/suppliers/types";

/**
 * GET /api/orders/[id]/blanks — single data source for the push dialog:
 * the order's blank items with their resolved supplier, per-supplier SKU
 * mapping prefills, and existing supplier pushes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      supplierPushes: { include: { supplier: { select: { key: true, name: true, adapterType: true } } } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const blankItems = order.orderItems.filter((i) => i.itemType === "other");
  const { groups, unroutable } = await resolveSupplierGroups(blankItems);

  const supplierByItemId = new Map<string, { id: string; key: string; name: string; adapterType: string }>();
  for (const g of groups) {
    for (const item of g.items) {
      supplierByItemId.set(item.id, { id: g.supplier.id, key: g.supplier.key, name: g.supplier.name, adapterType: g.supplier.adapterType });
    }
  }
  const unroutableById = new Map(unroutable.map((u) => [u.itemId, u.reason]));

  // Per-supplier SKU mapping prefills for the items we can route
  const mappingLookups = groups.flatMap((g) =>
    g.items
      .filter((i) => i.sku)
      .map((i) => ({ ourSku: i.sku!, variantTitle: i.variantTitle ?? "", supplierId: g.supplier.id }))
  );
  const mappingRows = mappingLookups.length
    ? await prisma.skuMapping.findMany({ where: { OR: mappingLookups } })
    : [];

  const items = blankItems.map((item) => {
    const supplier = supplierByItemId.get(item.id) ?? null;
    const mapping = supplier
      ? mappingRows.find(
          (r) =>
            r.ourSku === item.sku &&
            r.variantTitle === (item.variantTitle ?? "") &&
            r.supplierId === supplier.id
        )
      : null;
    return {
      id: item.id,
      title: item.title,
      variantTitle: item.variantTitle,
      sku: item.sku,
      quantity: item.quantity,
      vendor: item.vendor,
      normalizedVendor: item.vendor ? normalizeVendor(item.vendor) : null,
      designFileUrl: item.designFileUrl,
      printEnabled: item.printEnabled,
      supplier,
      unroutableReason: unroutableById.get(item.id) ?? null,
      prefill: mapping
        ? {
            factorySku: mapping.factorySku,
            factorySize: mapping.factorySize,
            factoryColor: mapping.factoryColor,
            factoryStyle: mapping.factoryStyle,
            factoryCraftType: mapping.factoryCraftType,
          }
        : null,
      supplierOrderNo: item.supplierOrderNo,
      supplierPushedAt: item.supplierPushedAt,
    };
  });

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.shopifyOrderNumber,
    items,
    pushes: order.supplierPushes.map((p) => ({
      id: p.id,
      platformOid: p.platformOid,
      supplierKey: p.supplier.key,
      supplierName: p.supplier.name,
      supplierAdapterType: p.supplier.adapterType,
      itemIds: p.itemIds,
      placedAt: p.placedAt,
      pushedAt: p.pushedAt,
      orderStatus: p.orderStatus,
      orderStatusStr: p.orderStatusStr,
      statusSyncedAt: p.statusSyncedAt,
      lastError: p.lastError,
    })),
  });
}
