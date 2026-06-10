/**
 * Split fulfillment group helpers shared by the order detail page and the
 * OMS push dialog. A "group" is a Shopify fulfillment order that the order's
 * line items were split into (Phase 1). Items carry shopifyFulfillmentOrderId.
 */

/** Human label for an item type within a split fulfillment group. */
export function groupLabelFromType(itemType: string): string {
  if (itemType === "free_sample") return "Free Sample";
  if (itemType === "transfer_by_size" || itemType === "gangsheet") return "Transfer";
  return "Blanks";
}

/**
 * Derive the split fulfillment groups for an order from its items'
 * shopifyFulfillmentOrderId. Returns [] when the order isn't split.
 */
export function getFulfillmentGroups(
  items: { itemType: string; shopifyFulfillmentOrderId: string | null }[]
): { foId: string; num: number; label: string }[] {
  const byFo = new Map<string, Set<string>>();
  for (const item of items) {
    const fo = item.shopifyFulfillmentOrderId;
    if (!fo) continue;
    if (!byFo.has(fo)) byFo.set(fo, new Set());
    byFo.get(fo)!.add(item.itemType);
  }
  if (byFo.size <= 1) return [];
  return [...byFo.entries()].map(([foId, types], idx) => ({
    foId,
    num: idx + 1,
    label: [...new Set([...types].map(groupLabelFromType))].join("/"),
  }));
}
