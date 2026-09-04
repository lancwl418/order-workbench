/**
 * Split fulfillment group helpers shared by the order detail page and the
 * OMS push dialog. A "group" is a Shopify fulfillment order that the order's
 * line items were split into (Phase 1). Items carry shopifyFulfillmentOrderId.
 */

/** Item types that are printed transfers (Drip-built or Ready to Print). */
export function isTransferItemType(itemType: string): boolean {
  return (
    itemType === "transfer_by_size" ||
    itemType === "gangsheet" ||
    itemType === "ready_print"
  );
}

/** Human label for an item type within a split fulfillment group. */
export function groupLabelFromType(itemType: string): string {
  if (itemType === "free_sample") return "Free Sample";
  if (isTransferItemType(itemType)) return "Transfer";
  return "Blanks";
}

/**
 * Derive the split fulfillment groups for an order from its items'
 * shopifyFulfillmentOrderId. Returns [] when the order isn't split.
 */
export function getFulfillmentGroups(
  items: { title?: string; itemType: string; shopifyFulfillmentOrderId: string | null }[]
): { foId: string; num: number; label: string; titles: string[] }[] {
  const byFo = new Map<string, { types: Set<string>; titles: string[] }>();
  for (const item of items) {
    const fo = item.shopifyFulfillmentOrderId;
    if (!fo) continue;
    if (!byFo.has(fo)) byFo.set(fo, { types: new Set(), titles: [] });
    const g = byFo.get(fo)!;
    g.types.add(item.itemType);
    if (item.title) g.titles.push(item.title);
  }
  if (byFo.size <= 1) return [];
  return [...byFo.entries()].map(([foId, g], idx) => ({
    foId,
    num: idx + 1,
    label: [...new Set([...g.types].map(groupLabelFromType))].join("/"),
    titles: g.titles,
  }));
}
