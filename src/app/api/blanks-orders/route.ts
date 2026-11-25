import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { REJECTED_ORDER_STATUS } from "@/lib/suppliers/types";

/**
 * GET /api/blanks-orders — paginated orders containing supplier-pushable
 * items, with per-order push/status summary. Data source for the Blanks and
 * Printed Apparel pages.
 *
 * Query params: page, pageSize, q (order number search),
 * type = other (blanks, default) | printed_apparel,
 * filter = all | unpushed | placed | pushed | partial | rejected
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  const q = url.searchParams.get("q")?.trim();
  const filter = url.searchParams.get("filter") ?? "all";
  const itemType = url.searchParams.get("type") === "printed_apparel" ? "printed_apparel" : "other";

  const where: Prisma.OrderWhereInput = {
    orderItems: { some: { itemType } },
    ...(q ? { shopifyOrderNumber: { contains: q, mode: "insensitive" } } : {}),
  };

  // Orders with at least one push record but some item of this category not
  // covered by any push's itemIds — "partially unpushed". itemIds is an
  // array column, so coverage needs raw SQL. Also powers the dashboard count.
  const partialRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT oi.order_id AS id
    FROM order_items oi
    WHERE oi.item_type = ${itemType}
      AND EXISTS (SELECT 1 FROM supplier_pushes sp WHERE sp.order_id = oi.order_id)
      AND NOT EXISTS (
        SELECT 1 FROM supplier_pushes sp2
        WHERE sp2.order_id = oi.order_id AND oi.id = ANY(sp2.item_ids)
      )
  `);

  if (filter === "unpushed") {
    where.supplierPushes = { none: {} };
  } else if (filter === "placed") {
    // has at least one placed-but-not-pushed group
    where.supplierPushes = { some: { pushedAt: null } };
  } else if (filter === "pushed") {
    where.supplierPushes = { some: { pushedAt: { not: null } } };
  } else if (filter === "partial") {
    where.id = { in: partialRows.map((r) => r.id) };
  } else if (filter === "rejected") {
    where.supplierPushes = { some: { orderStatus: REJECTED_ORDER_STATUS } };
  }

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { shopifyCreatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderNumber: true,
        customerName: true,
        internalStatus: true,
        labelStatus: true,
        trackingNumber: true,
        carrier: true,
        shopifyCreatedAt: true,
        orderItems: {
          where: { itemType },
          select: {
            id: true,
            title: true,
            variantTitle: true,
            sku: true,
            quantity: true,
            vendor: true,
            printEnabled: true,
            supplierOrderNo: true,
            supplierPushedAt: true,
            shopifyFulfillmentOrderId: true,
          },
        },
        // Our own labels (OMS/manual). The UI keeps only those covering the
        // blanks' fulfillment group so the transfer label stays out.
        shipments: {
          select: {
            id: true,
            trackingNumber: true,
            carrier: true,
            providerName: true,
            shopifyFulfillmentOrderId: true,
            createdAt: true,
            syncStatus: true,
          },
          orderBy: { createdAt: "asc" },
        },
        supplierPushes: {
          select: {
            id: true,
            platformOid: true,
            itemIds: true,
            placedAt: true,
            pushedAt: true,
            orderStatus: true,
            orderStatusStr: true,
            statusSyncedAt: true,
            trackingNumber: true,
            carrier: true,
            waybillUrl: true,
            shippedAt: true,
            rejectionStatus: true,
            rejectionHandledBy: true,
            lastError: true,
            supplier: { select: { id: true, key: true, name: true, adapterType: true, consoleUrl: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  // Dashboard counts for this category (not affected by q/filter)
  const baseWhere: Prisma.OrderWhereInput = { orderItems: { some: { itemType } } };
  const [sumTotal, sumUnpushed, sumPlaced, sumPushed, sumRejected] = await Promise.all([
    prisma.order.count({ where: baseWhere }),
    prisma.order.count({ where: { ...baseWhere, supplierPushes: { none: {} } } }),
    prisma.order.count({ where: { ...baseWhere, supplierPushes: { some: { pushedAt: null } } } }),
    prisma.order.count({ where: { ...baseWhere, supplierPushes: { some: { pushedAt: { not: null } } } } }),
    prisma.order.count({
      where: { ...baseWhere, supplierPushes: { some: { orderStatus: REJECTED_ORDER_STATUS } } },
    }),
  ]);
  const summary = {
    total: sumTotal,
    unpushed: sumUnpushed,
    placed: sumPlaced,
    pushed: sumPushed,
    partial: partialRows.length,
    rejected: sumRejected,
  };

  // Global rejection workload for the summary banner (not page-scoped)
  const rejectionRows = await prisma.supplierPush.groupBy({
    by: ["rejectionStatus"],
    where: { orderStatus: REJECTED_ORDER_STATUS },
    _count: true,
  });
  const rejectedSummary = { pending: 0, handling: 0, resolved: 0 };
  for (const r of rejectionRows) {
    const key = (r.rejectionStatus ?? "pending") as keyof typeof rejectedSummary;
    if (key in rejectedSummary) rejectedSummary[key] += r._count;
  }

  return NextResponse.json({
    orders,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    summary,
    rejectedSummary,
  });
}
