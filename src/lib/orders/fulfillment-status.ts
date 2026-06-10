/**
 * Aggregate the internal status of a SPLIT order from its per-group shipments.
 *
 * A split order has its line items distributed across several Shopify
 * fulfillment orders (groups). The whole order should only advance to a status
 * once EVERY group has reached it — e.g. SHIPPED only when all groups shipped,
 * DELIVERED only when all groups delivered. Otherwise it stays at the slowest
 * group's level (partial fulfillment).
 *
 * Returns null when the order is not split (0 or 1 group) — callers should then
 * fall back to the existing single-fulfillment logic.
 */

export interface ItemLike {
  shopifyFulfillmentOrderId: string | null;
}

export interface ShipmentLike {
  shopifyFulfillmentOrderId: string | null;
  status: string | null;
  trackingNumber: string | null;
}

/** Progress rank for a shipment status (higher = further along). */
export function statusRank(status: string | null, hasTracking: boolean): number {
  const s = (status || "").toLowerCase();
  if (s === "delivered") return 4;
  if (s === "shipped" || s === "in_transit" || s === "out_for_delivery") return 3;
  if (
    s === "label_created" ||
    s === "label_printed" ||
    s === "label_purchased" ||
    s === "confirmed" ||
    hasTracking
  ) {
    return 2;
  }
  return 1; // pending / unknown
}

function isDelayed(status: string | null): boolean {
  const s = (status || "").toLowerCase();
  return s === "failure" || s === "attempted_delivery" || s === "exception";
}

/** Distinct fulfillment-order groups present on the order's items. */
export function fulfillmentGroups(items: ItemLike[]): string[] {
  return [
    ...new Set(
      items
        .map((i) => i.shopifyFulfillmentOrderId)
        .filter((x): x is string => !!x)
    ),
  ];
}

/**
 * Compute the aggregated internal status for a split order, or null if the
 * order is not split or no group has made enough progress to advance.
 */
export function computeSplitOrderStatus(
  items: ItemLike[],
  shipments: ShipmentLike[]
): "DELAYED" | "DELIVERED" | "SHIPPED" | "LABEL_CREATED" | null {
  const groups = fulfillmentGroups(items);
  if (groups.length <= 1) return null; // not split

  let minRank = Infinity;
  let anyDelayed = false;

  for (const group of groups) {
    const groupShipments = shipments.filter(
      (s) => s.shopifyFulfillmentOrderId === group
    );
    let best = 0; // no shipment yet for this group
    for (const s of groupShipments) {
      if (isDelayed(s.status)) anyDelayed = true;
      best = Math.max(best, statusRank(s.status, !!s.trackingNumber));
    }
    minRank = Math.min(minRank, best);
  }

  if (anyDelayed) return "DELAYED";
  if (minRank >= 4) return "DELIVERED";
  if (minRank >= 3) return "SHIPPED";
  if (minRank >= 2) return "LABEL_CREATED";
  return null; // not all groups have progressed enough; leave status unchanged
}
