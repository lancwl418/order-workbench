import { prisma } from "@/lib/prisma";
import { fetchOrderById, transformShopifyOrder } from "./orders";

/**
 * Refresh designFileUrl for all order items by re-fetching from Shopify.
 *
 * Only updates items whose URL has NOT been manually replaced
 * (i.e. originalDesignFileUrl is null). If the user replaced a file,
 * we respect their replacement and skip that item.
 *
 * Returns the number of items updated.
 */
export async function refreshPrintFileUrls(orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      shopifyOrderId: true,
      orderItems: {
        select: {
          id: true,
          shopifyLineItemId: true,
          designFileUrl: true,
          originalDesignFileUrl: true,
        },
      },
    },
  });

  if (!order?.shopifyOrderId) return 0;

  let shopifyOrder;
  try {
    shopifyOrder = await fetchOrderById(order.shopifyOrderId);
  } catch (e) {
    console.error("Failed to fetch order from Shopify for URL refresh:", e);
    return 0;
  }

  const { items: freshItems } = transformShopifyOrder(shopifyOrder);

  // Build lookup: shopifyLineItemId → fresh designFileUrl
  const freshUrlMap = new Map<string, string | null>();
  for (const item of freshItems) {
    freshUrlMap.set(item.shopifyLineItemId, item.designFileUrl);
  }

  let updated = 0;

  for (const dbItem of order.orderItems) {
    if (!dbItem.shopifyLineItemId) continue;

    // Skip manually replaced files
    if (dbItem.originalDesignFileUrl) continue;

    const freshUrl = freshUrlMap.get(dbItem.shopifyLineItemId) ?? null;

    // Only update if URL actually changed
    if (freshUrl && freshUrl !== dbItem.designFileUrl) {
      await prisma.orderItem.update({
        where: { id: dbItem.id },
        data: { designFileUrl: freshUrl },
      });
      updated++;
    }
  }

  return updated;
}
