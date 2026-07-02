import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchFulfillmentGroupInfo } from "@/lib/shopify/split";
import type { ShopifyOrder } from "@/lib/shopify/types";

/**
 * Record per-group delivery methods for a natively split order (a checkout
 * spanning multiple shipping profiles creates one fulfillment order per
 * profile, each with its own method — e.g. blanks → Standard, transfers →
 * Express). Stores Order.groupShippingMethods ({ foId: "Express" | ... }).
 *
 * Deliberately does NOT assign items to groups: splitting stays a manual
 * action in the workbench (the split route does the assignment). Only runs
 * for orders with more than one shipping line. Never throws: a Shopify API
 * failure must not break order sync/webhooks.
 */
export async function syncFulfillmentGroupsFromShopify(
  localOrderId: string,
  shopifyOrder: ShopifyOrder
): Promise<void> {
  if ((shopifyOrder.shipping_lines?.length ?? 0) <= 1) return;
  await syncGroupMethodsFromShopify(localOrderId, String(shopifyOrder.id), {
    assignItems: false,
  });
}

/**
 * Fetch the order's fulfillment orders and persist per-group delivery
 * methods — and, after a workbench split (assignItems: true), each item's
 * fulfillment-order assignment — so the per-group badges and actions work
 * immediately. Never throws.
 */
export async function syncGroupMethodsFromShopify(
  localOrderId: string,
  shopifyOrderId: string,
  opts: { assignItems?: boolean } = {}
): Promise<void> {
  try {
    const fos = await fetchFulfillmentGroupInfo(shopifyOrderId);
    // Cancelled FOs are leftovers from moves/splits; their line items now
    // live in another fulfillment order.
    const active = fos.filter(
      (fo) => fo.status !== "CANCELLED" && fo.shopifyLineItemIds.length > 0
    );
    if (active.length <= 1) return;

    if (opts.assignItems !== false) {
      for (const fo of active) {
        await prisma.orderItem.updateMany({
          where: {
            orderId: localOrderId,
            shopifyLineItemId: { in: fo.shopifyLineItemIds },
          },
          data: { shopifyFulfillmentOrderId: fo.foId },
        });
      }
    }

    const methods: Record<string, string> = {};
    for (const fo of active) {
      if (fo.deliveryMethodName) methods[fo.foId] = fo.deliveryMethodName;
    }
    await prisma.order.update({
      where: { id: localOrderId },
      data: {
        groupShippingMethods:
          Object.keys(methods).length > 0
            ? (methods as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
  } catch (err) {
    console.error(
      `[SyncGroups] Failed to sync fulfillment groups for order ${localOrderId} (shopify ${shopifyOrderId}):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Resolve which fulfillment-order group a Shopify fulfillment belongs to,
 * from the fulfilled line items. Returns the group id when ALL fulfilled
 * items sit in the same group, otherwise null (whole-order / mixed).
 * Used so shipments created in the Shopify admin land on the right group
 * in the split-order UI.
 */
export async function foIdForLineItems(
  orderId: string,
  shopifyLineItemIds: string[]
): Promise<string | null> {
  if (shopifyLineItemIds.length === 0) return null;
  const items = await prisma.orderItem.findMany({
    where: { orderId, shopifyLineItemId: { in: shopifyLineItemIds } },
    select: { shopifyFulfillmentOrderId: true },
  });
  const fos = new Set(
    items
      .map((i) => i.shopifyFulfillmentOrderId)
      .filter((v): v is string => Boolean(v))
  );
  return fos.size === 1 ? [...fos][0] : null;
}
