import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { splitFulfillmentOrders, type SplitGroup } from "@/lib/shopify/split";

const splitSchema = z.object({
  groups: z
    .array(z.object({ orderItemIds: z.array(z.string()).min(1) }))
    .min(2, "Provide at least two groups to split"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = splitSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { groups } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { orderItems: { select: { id: true, shopifyLineItemId: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!order.shopifyOrderId) {
    return NextResponse.json(
      { error: "Order is not linked to Shopify" },
      { status: 400 }
    );
  }

  // Validate the groups partition the order's items exactly once each.
  const itemById = new Map(order.orderItems.map((i) => [i.id, i]));
  const assigned = new Set<string>();
  for (const g of groups) {
    for (const itemId of g.orderItemIds) {
      if (!itemById.has(itemId)) {
        return NextResponse.json(
          { error: `Item ${itemId} does not belong to this order` },
          { status: 400 }
        );
      }
      if (assigned.has(itemId)) {
        return NextResponse.json(
          { error: `Item ${itemId} assigned to more than one group` },
          { status: 400 }
        );
      }
      assigned.add(itemId);
    }
  }
  if (assigned.size !== order.orderItems.length) {
    return NextResponse.json(
      { error: "Every line item must be assigned to exactly one group" },
      { status: 400 }
    );
  }

  // Translate groups to Shopify line item ids.
  const shopifyGroups: SplitGroup[] = [];
  for (const g of groups) {
    const shopifyLineItemIds: string[] = [];
    for (const itemId of g.orderItemIds) {
      const li = itemById.get(itemId)!.shopifyLineItemId;
      if (!li) {
        return NextResponse.json(
          { error: `Item ${itemId} has no Shopify line item id and cannot be split` },
          { status: 400 }
        );
      }
      shopifyLineItemIds.push(li);
    }
    shopifyGroups.push({ shopifyLineItemIds });
  }

  let mapping: Record<string, string>;
  try {
    mapping = await splitFulfillmentOrders(order.shopifyOrderId, shopifyGroups);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Split failed";
    console.error(`[Split] order ${id}: ${msg}`);
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

  // Persist the resulting fulfillment-order grouping onto each item.
  await prisma.$transaction(async (tx) => {
    for (const item of order.orderItems) {
      if (!item.shopifyLineItemId) continue;
      const foId = mapping[item.shopifyLineItemId];
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
        message: `Split order into ${groups.length} fulfillment group(s)`,
        metadata: { groups: groups.map((g) => g.orderItemIds) },
      },
    });
  });

  const distinctFos = new Set(Object.values(mapping));
  return NextResponse.json({
    success: true,
    groups: distinctFos.size,
    mapping,
  });
}
