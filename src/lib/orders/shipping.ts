/**
 * Shared shipping-method helpers. Single source of truth for classifying a
 * delivery method as Express — previously this substring check was duplicated
 * across the order list and detail page.
 */

/** Keywords (lowercase) that mark a delivery method as expedited. */
const EXPRESS_KEYWORDS = [
  "express",
  "expedited",
  "overnight",
  "next day",
  "next-day",
  "rush",
  "urgent",
];

/** True when the delivery method should be treated as Express. */
export function isExpressMethod(method?: string | null): boolean {
  if (!method) return false;
  const m = method.toLowerCase();
  return EXPRESS_KEYWORDS.some((k) => m.includes(k));
}

/**
 * Narrow an Order.groupShippingMethods JSON value to a foId -> method map.
 * Returns null when there is no usable per-group data.
 */
export function getGroupMethods(
  value: unknown
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * The delivery method for one fulfillment group, falling back to the
 * order-level method when the group has no specific method recorded.
 */
export function groupMethodFor(
  groupMethods: Record<string, string> | null,
  foId: string,
  orderMethod?: string | null
): string | null {
  return groupMethods?.[foId] ?? orderMethod ?? null;
}
