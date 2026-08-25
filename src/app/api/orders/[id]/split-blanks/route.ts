import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { splitFulfillmentOrders, type SplitGroup } from "@/lib/shopify/split";
import { syncGroupMethodsFromShopify } from "@/lib/orders/sync-groups";

/**
 * POST /api/orders/[id]/split-blanks
 *
 * Ensure a mixed order (blanks + transfer/other) has its blanks in their own
 * fulfillment group, splitting on Shopify when needed. Idempotent:
 * - single-type order → nothing to split
 * - already separated → returns the existing blanks group
 * Returns { split, blanksFulfillmentOrderId } for label creation to target.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      orderItems: {
        select: { id: true, itemType: true, shopifyLineItemId: true, shopifyFulfillmentOrderId: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const blanks = order.orderItems.filter((i) => i.itemType === "other");
  const others = order.orderItems.filter((i) => i.itemType !== "other");
  if (blanks.length === 0) {
    return NextResponse.json({ error: "Order has no blank items" }, { status: 400 });
  }

  // Single-type order — nothing to separate.
  if (others.length === 0) {
    return NextResponse.json({
      split: false,
      blanksFulfillmentOrderId: blanks[0].shopifyFulfillmentOrderId ?? null,
    });
  }

  // Already separated: every blanks item sits in a group no non-blank shares.
  const blanksFoIds = new Set(blanks.map((i) => i.shopifyFulfillmentOrderId));
  const otherFoIds = new Set(others.map((i) => i.shopifyFulfillmentOrderId));
  const separated =
    !blanksFoIds.has(null) && [...blanksFoIds].every((fo) => !otherFoIds.has(fo));
  if (separated) {
    return NextResponse.json({
      split: false,
      blanksFulfillmentOrderId: blanks[0].shopifyFulfillmentOrderId,
    });
  }

  if (!order.shopifyOrderId) {
    return NextResponse.json(
      { error: "Order is not linked to Shopify — cannot split" },
      { status: 400 }
    );
  }
  const missingLineItem = order.orderItems.find((i) => !i.shopifyLineItemId);
  if (missingLineItem) {
    return NextResponse.json(
      { error: "Order has items without Shopify line item ids — cannot split" },
      { status: 400 }
    );
  }

  const shopifyGroups: SplitGroup[] = [
    { shopifyLineItemIds: blanks.map((i) => i.shopifyLineItemId!) },
    { shopifyLineItemIds: others.map((i) => i.shopifyLineItemId!) },
  ];

  let mapping: Record<string, string>;
  try {
    mapping = await splitFulfillmentOrders(order.shopifyOrderId, shopifyGroups);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Split failed";
    await prisma.orderLog.create({
      data: {
        orderId: id,
        userId: session.user?.id,
        action: "fulfillment_split_failed",
        message: msg.substring(0, 500),
      },
    });
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of order.orderItems) {
      const foId = item.shopifyLineItemId ? mapping[item.shopifyLineItemId] : undefined;
      if (!foId) continue;
      await tx.orderItem.update({
        where: { id: item.id },
        data: { shopifyFulfillmentOrderId: foId },
      });
    }
    await tx.orderLog.create({
      data: {
        orderId: id,
        userId: session.user?.id,
        action: "fulfillment_split",
        message: "Auto-split blanks into their own fulfillment group",
        metadata: {
          blanks: blanks.map((i) => i.id),
          others: others.map((i) => i.id),
        },
      },
    });
  });

  await syncGroupMethodsFromShopify(id, order.shopifyOrderId);

  const blanksFulfillmentOrderId = mapping[blanks[0].shopifyLineItemId!] ?? null;
  return NextResponse.json({ split: true, blanksFulfillmentOrderId });
}
