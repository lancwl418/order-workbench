import { prisma } from "@/lib/prisma";
import { fetchOrderById, transformShopifyOrderWithProducts } from "./orders";

/**
 * Refresh designFileUrl(s) for all order items by re-fetching from Shopify.
 *
 * Only updates items whose URL has NOT been manually replaced
 * (i.e. originalDesignFileUrl is null). If the user replaced a file,
 * we respect their replacement and skip that item.
 *
 * Also promotes an item to ready_print when the fresh classification says so
 * (e.g. the product was tagged `readyprint` after the order synced).
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
          itemType: true,
          designFileUrl: true,
          designFileUrls: true,
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

  const { items: freshItems } = await transformShopifyOrderWithProducts(shopifyOrder);

  // Build lookup: shopifyLineItemId → fresh item data
  const freshMap = new Map<
    string,
    { designFileUrl: string | null; designFileUrls: string[]; itemType: string }
  >();
  for (const item of freshItems) {
    freshMap.set(item.shopifyLineItemId, {
      designFileUrl: item.designFileUrl,
      designFileUrls: item.designFileUrls,
      itemType: item.itemType,
    });
  }

  let updated = 0;

  for (const dbItem of order.orderItems) {
    if (!dbItem.shopifyLineItemId) continue;

    // Skip manually replaced files
    if (dbItem.originalDesignFileUrl) continue;

    const fresh = freshMap.get(dbItem.shopifyLineItemId);
    if (!fresh?.designFileUrl) continue;

    const freshUrls = fresh.designFileUrls ?? [];
    const urlChanged = fresh.designFileUrl !== dbItem.designFileUrl;
    const urlsChanged =
      freshUrls.join("\n") !== (dbItem.designFileUrls ?? []).join("\n");
    const typeChanged =
      fresh.itemType === "ready_print" && dbItem.itemType !== "ready_print";

    if (urlChanged || urlsChanged || typeChanged) {
      await prisma.orderItem.update({
        where: { id: dbItem.id },
        data: {
          designFileUrl: fresh.designFileUrl,
          designFileUrls: freshUrls,
          ...(typeChanged ? { itemType: fresh.itemType } : {}),
        },
      });
      updated++;
    }
  }

  return updated;
}
