import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchFulfillmentGroupInfo } from "@/lib/shopify/split";
import type { ShopifyOrder } from "@/lib/shopify/types";

/**
 * Sync a natively split order's fulfillment groups from Shopify.
 *
 * A checkout spanning multiple shipping profiles creates multiple fulfillment
 * orders (each with its own delivery method, e.g. blanks → Standard and
 * transfers → Express) without any workbench-side split. This persists:
 *  - each item's shopifyFulfillmentOrderId (so the order shows as split), and
 *  - Order.groupShippingMethods ({ foId: "Express" | "Standard" | ... }).
 *
 * Only runs for orders with more than one shipping line — single-method
 * orders don't need per-group methods on the sync path (use
 * syncGroupMethodsFromShopify directly after a workbench split).
 * Never throws: a Shopify API failure must not break order sync/webhooks.
 */
export async function syncFulfillmentGroupsFromShopify(
  localOrderId: string,
  shopifyOrder: ShopifyOrder
): Promise<void> {
  if ((shopifyOrder.shipping_lines?.length ?? 0) <= 1) return;
  await syncGroupMethodsFromShopify(localOrderId, String(shopifyOrder.id));
}

/**
 * Fetch the order's fulfillment orders and persist per-item FO assignment +
 * per-group delivery methods, regardless of shipping-line count. Called right
 * after a workbench split so each group's Standard/Express is known
 * immediately (the OMS option is gated per group on it). Never throws.
 */
export async function syncGroupMethodsFromShopify(
  localOrderId: string,
  shopifyOrderId: string
): Promise<void> {
  try {
    const fos = await fetchFulfillmentGroupInfo(shopifyOrderId);
    // Cancelled FOs are leftovers from moves/splits; their line items now
    // live in another fulfillment order.
    const active = fos.filter(
      (fo) => fo.status !== "CANCELLED" && fo.shopifyLineItemIds.length > 0
    );
    if (active.length <= 1) return;

    for (const fo of active) {
      await prisma.orderItem.updateMany({
        where: {
          orderId: localOrderId,
          shopifyLineItemId: { in: fo.shopifyLineItemIds },
        },
        data: { shopifyFulfillmentOrderId: fo.foId },
      });
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
