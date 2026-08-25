import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSupplierGroups } from "@/lib/suppliers/push-service";
import { normalizeVendor } from "@/lib/suppliers/types";

const REQUIRED_CONSIGNEE_FIELDS = ["name", "phone", "address", "city", "province", "country"] as const;

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
      supplierPushes: { include: { supplier: { select: { key: true, name: true, adapterType: true, consoleUrl: true } } } },
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

  // SKU mapping prefills across ALL suppliers, keyed per supplier — the
  // dialog re-prefills when an item is switched to an alternate supplier.
  const mappingLookups = blankItems
    .filter((i) => i.sku)
    .map((i) => ({ ourSku: i.sku!, variantTitle: i.variantTitle ?? "" }));
  const mappingRows = mappingLookups.length
    ? await prisma.skuMapping.findMany({ where: { OR: mappingLookups } })
    : [];

  const toPrefill = (r: (typeof mappingRows)[number]) => ({
    factorySku: r.factorySku,
    factorySize: r.factorySize,
    factoryColor: r.factoryColor,
    factoryStyle: r.factoryStyle,
    factoryCraftType: r.factoryCraftType,
  });

  const items = blankItems.map((item) => {
    const supplier = supplierByItemId.get(item.id) ?? null;
    const itemRows = mappingRows.filter(
      (r) => r.ourSku === item.sku && r.variantTitle === (item.variantTitle ?? "")
    );
    const prefills: Record<string, ReturnType<typeof toPrefill>> = {};
    for (const r of itemRows) {
      if (r.supplierId) prefills[r.supplierId] = toPrefill(r);
    }
    const mapping = supplier ? itemRows.find((r) => r.supplierId === supplier.id) : null;
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
      prefill: mapping ? toPrefill(mapping) : null,
      prefills,
      supplierOrderNo: item.supplierOrderNo,
      supplierPushedAt: item.supplierPushedAt,
    };
  });

  const suppliers = await prisma.supplier.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, key: true, name: true, adapterType: true },
  });

  // Consignee prefill for the dialog's editable address section. Raw field
  // access (not buildSupplierConsignee) so partially-filled addresses still
  // prefill what they have.
  const a = (order.shippingAddress as Record<string, string | undefined> | null) ?? {};
  const consignee = {
    name: [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || order.customerName || "",
    phone: a.phone || order.customerPhone || "",
    address: a.address1 || "",
    addressOptional: a.address2 || "",
    city: a.city || "",
    province: a.province_code || a.province || "",
    country: a.country_code || a.country || "",
    postCode: a.zip || a.postal_code || "",
  };
  const consigneeMissing = REQUIRED_CONSIGNEE_FIELDS.filter((k) => !consignee[k]?.trim());

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.shopifyOrderNumber,
    consignee,
    consigneeMissing,
    suppliers,
    items,
    pushes: order.supplierPushes.map((p) => ({
      id: p.id,
      platformOid: p.platformOid,
      supplierKey: p.supplier.key,
      supplierName: p.supplier.name,
      supplierAdapterType: p.supplier.adapterType,
      supplierConsoleUrl: p.supplier.consoleUrl,
      itemIds: p.itemIds,
      placedAt: p.placedAt,
      pushedAt: p.pushedAt,
      orderStatus: p.orderStatus,
      orderStatusStr: p.orderStatusStr,
      statusSyncedAt: p.statusSyncedAt,
      trackingNumber: p.trackingNumber,
      carrier: p.carrier,
      waybillUrl: p.waybillUrl,
      shippedAt: p.shippedAt,
      lastError: p.lastError,
    })),
  });
}
