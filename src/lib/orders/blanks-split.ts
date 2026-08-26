import { prisma } from "@/lib/prisma";
import { splitFulfillmentOrders, type SplitGroup } from "@/lib/shopify/split";
import { syncGroupMethodsFromShopify } from "@/lib/orders/sync-groups";

/**
 * Ensure the order's fulfillment groups mirror how the blanks actually ship:
 * one group per supplier (an order can push to several factories, each with
 * its own tracking), one group for not-yet-pushed blanks, one for everything
 * else (transfer etc). Idempotent — no Shopify calls when the current groups
 * already match. Shared by the split-blanks route, the OMS label flow, and
 * the tracking→Shopify sync.
 */
export async function ensureBlanksSplit(
  orderId: string,
  userId?: string
): Promise<{
  split: boolean;
  error?: string;
  /** itemId → fulfillment order id after the operation (null when unknown). */
  foIdByItemId: Record<string, string> | null;
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: {
        select: {
          id: true,
          itemType: true,
          supplierId: true,
          shopifyLineItemId: true,
          shopifyFulfillmentOrderId: true,
        },
      },
    },
  });
  if (!order) return { split: false, error: "Order not found", foIdByItemId: null };

  const blanks = order.orderItems.filter((i) => i.itemType === "other");
  if (blanks.length === 0) {
    return { split: false, error: "Order has no blank items", foIdByItemId: null };
  }
  const others = order.orderItems.filter((i) => i.itemType !== "other");

  // Desired partition: blanks per supplier (+ unpushed blanks) + the rest
  const bySupplier = new Map<string, typeof blanks>();
  for (const item of blanks) {
    const key = item.supplierId ?? "__unassigned__";
    bySupplier.set(key, [...(bySupplier.get(key) ?? []), item]);
  }
  const desired = [...bySupplier.values()];
  if (others.length > 0) desired.push(others);

  const currentFoOf = (itemId: string) =>
    order.orderItems.find((i) => i.id === itemId)?.shopifyFulfillmentOrderId ?? null;

  if (desired.length <= 1) {
    return { split: false, foIdByItemId: null };
  }

  // Already separated? Every desired group shares one non-null foId that no
  // other group uses.
  const groupFoSets = desired.map((g) => new Set(g.map((i) => currentFoOf(i.id))));
  const separated = groupFoSets.every((set, idx) => {
    if (set.size !== 1 || set.has(null)) return false;
    const fo = [...set][0];
    return groupFoSets.every((other, j) => j === idx || !other.has(fo));
  });
  if (separated) {
    const foIdByItemId: Record<string, string> = {};
    for (const i of order.orderItems) {
      if (i.shopifyFulfillmentOrderId) foIdByItemId[i.id] = i.shopifyFulfillmentOrderId;
    }
    return { split: false, foIdByItemId };
  }

  if (!order.shopifyOrderId) {
    return { split: false, error: "Order is not linked to Shopify — cannot split", foIdByItemId: null };
  }
  if (order.orderItems.some((i) => !i.shopifyLineItemId)) {
    return {
      split: false,
      error: "Order has items without Shopify line item ids — cannot split",
      foIdByItemId: null,
    };
  }

  const shopifyGroups: SplitGroup[] = desired.map((g) => ({
    shopifyLineItemIds: g.map((i) => i.shopifyLineItemId!),
  }));

  let mapping: Record<string, string>;
  try {
    mapping = await splitFulfillmentOrders(order.shopifyOrderId, shopifyGroups);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Split failed";
    await prisma.orderLog.create({
      data: {
        orderId,
        userId,
        action: "fulfillment_split_failed",
        message: msg.substring(0, 500),
      },
    });
    return { split: false, error: msg, foIdByItemId: null };
  }

  const foIdByItemId: Record<string, string> = {};
  await prisma.$transaction(async (tx) => {
    for (const item of order.orderItems) {
      const foId = item.shopifyLineItemId ? mapping[item.shopifyLineItemId] : undefined;
      if (!foId) continue;
      foIdByItemId[item.id] = foId;
      await tx.orderItem.update({
        where: { id: item.id },
        data: { shopifyFulfillmentOrderId: foId },
      });
    }
    await tx.orderLog.create({
      data: {
        orderId,
        userId,
        action: "fulfillment_split",
        message: `Auto-split into ${desired.length} fulfillment group(s) (blanks per supplier)`,
        metadata: { groups: desired.map((g) => g.map((i) => i.id)) },
      },
    });
  });

  await syncGroupMethodsFromShopify(orderId, order.shopifyOrderId);
  return { split: true, foIdByItemId };
}
