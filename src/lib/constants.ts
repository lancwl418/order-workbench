export const INTERNAL_STATUSES = [
  "NEW",
  "REVIEW",
  "READY_TO_PRINT",
  "PRINTING",
  "PRINTED",
  "READY_TO_SHIP",
  "LABEL_CREATED",
  "SHIPPED",
  "ON_HOLD",
  "DELAYED",
  "CANCELLED",
] as const;

export const SHIPPING_ROUTES = [
  "NOT_ASSIGNED",
  "THIRD_PARTY",
  "SHOPIFY",
] as const;

export const LABEL_STATUSES = [
  "NOT_CREATED",
  "PENDING",
  "CREATED",
  "SYNCED_TO_SHOPIFY",
  "SYNC_FAILED",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  REVIEW: "Review",
  READY_TO_PRINT: "Ready to Print",
  PRINTING: "Printing",
  PRINTED: "Printed",
  READY_TO_SHIP: "Ready to Ship",
  LABEL_CREATED: "Label Created",
  SHIPPED: "Shipped",
  ON_HOLD: "On Hold",
  DELAYED: "Delayed",
  CANCELLED: "Cancelled",
  NOT_ASSIGNED: "Not Assigned",
  THIRD_PARTY: "Third Party",
  SHOPIFY: "Shopify",
  NOT_CREATED: "Not Created",
  PENDING: "Pending",
  CREATED: "Created",
  SYNCED_TO_SHOPIFY: "Synced",
  SYNC_FAILED: "Sync Failed",
  // Shopify shipment transit statuses
  label_purchased: "Label Purchased",
  label_printed: "Label Printed",
  confirmed: "Confirmed",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  attempted_delivery: "Attempted Delivery",
  ready_for_pickup: "Ready for Pickup",
  delivered: "Delivered",
  failure: "Delivery Failed",
  success: "Fulfilled",
  pending: "Pending",
  shipped: "Shipped",
};

export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  NEW: { bg: "bg-slate-100", text: "text-slate-700" },
  REVIEW: { bg: "bg-blue-100", text: "text-blue-700" },
  READY_TO_PRINT: { bg: "bg-indigo-100", text: "text-indigo-700" },
  PRINTING: { bg: "bg-purple-100", text: "text-purple-700" },
  PRINTED: { bg: "bg-cyan-100", text: "text-cyan-700" },
  READY_TO_SHIP: { bg: "bg-teal-100", text: "text-teal-700" },
  LABEL_CREATED: { bg: "bg-emerald-100", text: "text-emerald-700" },
  SHIPPED: { bg: "bg-green-100", text: "text-green-700" },
  ON_HOLD: { bg: "bg-amber-100", text: "text-amber-700" },
  DELAYED: { bg: "bg-red-100", text: "text-red-700" },
  CANCELLED: { bg: "bg-gray-200", text: "text-gray-500" },
  NOT_ASSIGNED: { bg: "bg-gray-100", text: "text-gray-500" },
  THIRD_PARTY: { bg: "bg-orange-100", text: "text-orange-700" },
  SHOPIFY: { bg: "bg-green-100", text: "text-green-700" },
  NOT_CREATED: { bg: "bg-gray-100", text: "text-gray-500" },
  PENDING: { bg: "bg-blue-100", text: "text-blue-700" },
  CREATED: { bg: "bg-green-100", text: "text-green-700" },
  SYNCED_TO_SHOPIFY: { bg: "bg-emerald-100", text: "text-emerald-700" },
  SYNC_FAILED: { bg: "bg-red-100", text: "text-red-700" },
  // Shopify shipment transit statuses
  label_purchased: { bg: "bg-gray-100", text: "text-gray-600" },
  label_printed: { bg: "bg-gray-100", text: "text-gray-600" },
  confirmed: { bg: "bg-blue-100", text: "text-blue-700" },
  in_transit: { bg: "bg-sky-100", text: "text-sky-700" },
  out_for_delivery: { bg: "bg-orange-100", text: "text-orange-700" },
  attempted_delivery: { bg: "bg-amber-100", text: "text-amber-700" },
  ready_for_pickup: { bg: "bg-teal-100", text: "text-teal-700" },
  delivered: { bg: "bg-green-100", text: "text-green-700" },
  failure: { bg: "bg-red-100", text: "text-red-700" },
  success: { bg: "bg-green-100", text: "text-green-700" },
  pending: { bg: "bg-slate-100", text: "text-slate-600" },
  shipped: { bg: "bg-sky-100", text: "text-sky-700" },
};

export const DELAY_COLORS = {
  RED: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700" },
  YELLOW: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-700" },
  BLUE: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" },
  GREY: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-500" },
};

export const CS_ISSUE_TYPES = [
  "address_issue",
  "artwork_issue",
  "size_change",
  "cancel_request",
  "refund_request",
  "delivery_inquiry",
  "reprint_request",
  "other",
] as const;

export const SLA_BUSINESS_DAYS = parseInt(process.env.SLA_BUSINESS_DAYS || "3", 10);

// ─── Exception Management ─────────────────────────────────────

export const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  NO_MOVEMENT_AFTER_LABEL: "No Movement",
  LONG_TRANSIT: "Long Transit",
  DELIVERY_FAILURE: "Delivery Failed",
  PRODUCTION_DELAY: "Production Delay",
};

export const EXCEPTION_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  INVESTIGATING: "Investigating",
  RESOLVED: "Resolved",
  AUTO_RESOLVED: "Auto-Resolved",
};

export const EXCEPTION_SEVERITY_LABELS: Record<string, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const EXCEPTION_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  NO_MOVEMENT_AFTER_LABEL: { bg: "bg-orange-100", text: "text-orange-700" },
  LONG_TRANSIT: { bg: "bg-amber-100", text: "text-amber-700" },
  DELIVERY_FAILURE: { bg: "bg-red-100", text: "text-red-700" },
  PRODUCTION_DELAY: { bg: "bg-purple-100", text: "text-purple-700" },
};

export const EXCEPTION_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  OPEN: { bg: "bg-red-100", text: "text-red-700" },
  INVESTIGATING: { bg: "bg-blue-100", text: "text-blue-700" },
  RESOLVED: { bg: "bg-green-100", text: "text-green-700" },
  AUTO_RESOLVED: { bg: "bg-emerald-100", text: "text-emerald-700" },
};

export const EXCEPTION_SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  HIGH: { bg: "bg-red-100", text: "text-red-700" },
  MEDIUM: { bg: "bg-amber-100", text: "text-amber-700" },
  LOW: { bg: "bg-slate-100", text: "text-slate-600" },
};

export const EXCEPTION_THRESHOLDS = {
  NO_MOVEMENT_DAYS: 2,
  LONG_TRANSIT_BUSINESS_DAYS: 7,
  PRODUCTION_DELAY_DAYS: 2,
} as const;

export const DELIVERY_FAILURE_STATUSES = [
  "failure",
  "attempted_delivery",
] as const;

export const PRODUCTION_COMPLETE_STATUSES = [
  "PRINTED",
  "READY_TO_SHIP",
  "LABEL_CREATED",
  "SHIPPED",
  "CANCELLED",
] as const;

/**
 * Status workflow: defines the linear progression of order statuses.
 * ON_HOLD and DELAYED are side-states (not in the main flow).
 */
const STATUS_FLOW = [
  "NEW",
  "REVIEW",
  "READY_TO_PRINT",
  "PRINTING",
  "PRINTED",
  "READY_TO_SHIP",
  "LABEL_CREATED",
  "SHIPPED",
] as const;

export function getNextStatus(current: string): string | null {
  const idx = STATUS_FLOW.indexOf(current as (typeof STATUS_FLOW)[number]);
  if (idx === -1 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

export function getPrevStatus(current: string): string | null {
  const idx = STATUS_FLOW.indexOf(current as (typeof STATUS_FLOW)[number]);
  if (idx <= 0) return null;
  return STATUS_FLOW[idx - 1];
}
