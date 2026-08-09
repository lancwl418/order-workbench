import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { REJECTED_ORDER_STATUS } from "@/lib/suppliers/types";

/**
 * GET /api/blanks-orders — paginated orders containing blank items
 * (itemType "other"), with per-order push/status summary. Data source for
 * the Blanks page.
 *
 * Query params: page, pageSize, q (order number search),
 * filter = all | unpushed | placed | pushed | rejected
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

  const where: Prisma.OrderWhereInput = {
    orderItems: { some: { itemType: "other" } },
    ...(q ? { shopifyOrderNumber: { contains: q, mode: "insensitive" } } : {}),
  };

  if (filter === "unpushed") {
    where.supplierPushes = { none: {} };
  } else if (filter === "placed") {
    // has at least one placed-but-not-pushed group
    where.supplierPushes = { some: { pushedAt: null } };
  } else if (filter === "pushed") {
    where.supplierPushes = { some: { pushedAt: { not: null } } };
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
          where: { itemType: "other" },
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
          },
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
            lastError: true,
            supplier: { select: { id: true, key: true, name: true, adapterType: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  return NextResponse.json({
    orders,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}
