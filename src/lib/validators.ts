import { z } from "zod";

export const orderQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  status: z
    .enum([
      "OPEN",
      "REVIEW",
      "LABEL_CREATED",
      "SHIPPED",
      "DELAYED",
      "CANCELLED",
      "DISMISSED",
      "PICKED_UP",
    ])
    .optional(),
  printStatus: z
    .enum(["NONE", "READY", "IN_QUEUE", "GROUPED", "DONE"])
    .optional(),
  shippingRoute: z.enum(["NOT_ASSIGNED", "THIRD_PARTY", "SHOPIFY"]).optional(),
  labelStatus: z
    .enum([
      "NOT_CREATED",
      "PENDING",
      "CREATED",
      "SYNCED_TO_SHOPIFY",
      "SYNC_FAILED",
    ])
    .optional(),
  search: z.string().optional(),
  sort: z.string().default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  view: z
    .enum(["all", "print-queue", "cs-queue", "exceptions"])
    .default("all"),
  delayFlag: z.coerce.boolean().optional(),
  csFlag: z.coerce.boolean().optional(),
});

export const orderUpdateSchema = z.object({
  internalStatus: z
    .enum([
      "OPEN",
      "REVIEW",
      "LABEL_CREATED",
      "SHIPPED",
      "DELAYED",
      "CANCELLED",
      "DISMISSED",
      "PICKED_UP",
    ])
    .optional(),
  printStatus: z
    .enum(["NONE", "READY", "IN_QUEUE", "GROUPED", "DONE"])
    .optional(),
  shippingRoute: z.enum(["NOT_ASSIGNED", "THIRD_PARTY", "SHOPIFY"]).optional(),
  labelStatus: z
    .enum([
      "NOT_CREATED",
      "PENDING",
      "CREATED",
      "SYNCED_TO_SHOPIFY",
      "SYNC_FAILED",
    ])
    .optional(),
  priority: z.number().int().min(0).max(5).optional(),
  assignedOperator: z.string().nullable().optional(),
  csNote: z.string().nullable().optional(),
  csFlag: z.boolean().optional(),
  csPriority: z.number().int().min(0).max(5).optional(),
  csIssueType: z.string().nullable().optional(),
  csRequiredAction: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  shippingMethod: z.string().nullable().optional(),
});

export const bulkUpdateSchema = z.object({
  orderIds: z.array(z.string()).min(1),
  internalStatus: z
    .enum([
      "OPEN",
      "REVIEW",
      "LABEL_CREATED",
      "SHIPPED",
      "DELAYED",
      "CANCELLED",
      "DISMISSED",
      "PICKED_UP",
    ])
    .optional(),
  printStatus: z
    .enum(["NONE", "READY", "IN_QUEUE", "GROUPED", "DONE"])
    .optional(),
  shippingRoute: z.enum(["NOT_ASSIGNED", "THIRD_PARTY", "SHOPIFY"]).optional(),
  assignedOperator: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(5).optional(),
});

export const printActionSchema = z.object({
  orderId: z.string(),
  action: z.enum(["print_started", "print_completed", "print_failed", "reprint"]),
  itemIds: z.array(z.string()).optional(),
  printerName: z.string().optional(),
  printConfig: z.record(z.string(), z.unknown()).optional(),
  printResult: z.string().optional(),
  notes: z.string().optional(),
});

export const shipmentCreateSchema = z.object({
  orderId: z.string(),
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  service: z.string().optional(),
  sourceType: z.enum(["SHOPIFY", "THIRD_PARTY", "MANUAL"]).default("MANUAL"),
});

export const shipmentUpdateSchema = z.object({
  trackingNumber: z.string().optional(),
  carrier: z.string().optional(),
  service: z.string().optional(),
  labelStatus: z
    .enum(["NOT_CREATED", "PENDING", "CREATED", "SYNCED_TO_SHOPIFY", "SYNC_FAILED"])
    .optional(),
  labelUrl: z.string().optional(),
  status: z.string().optional(),
  shippingCost: z.number().optional(),
});

export const exceptionQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  status: z
    .enum(["OPEN", "INVESTIGATING", "RESOLVED", "AUTO_RESOLVED"])
    .optional(),
  type: z
    .enum([
      "NO_MOVEMENT_AFTER_LABEL",
      "LONG_TRANSIT",
      "DELIVERY_FAILURE",
      "PRODUCTION_DELAY",
    ])
    .optional(),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  category: z.enum(["shipment", "processing"]).optional(),
  orderId: z.string().optional(),
});

export const addressOverrideSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  city: z.string().optional(),
  province_code: z.string().optional(),
  zip: z.string().optional(),
  country_code: z.string().optional(),
  phone: z.string().optional(),
});

export const exceptionUpdateSchema = z.object({
  status: z.enum(["INVESTIGATING", "RESOLVED"]).optional(),
  owner: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

// ─── Purchase Orders ──────────────────────────────────────────

export const purchaseOrderQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  status: z.enum(["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"]).optional(),
  search: z.string().optional(),
  sort: z.string().default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const purchaseOrderCreateSchema = z.object({
  poNumber: z.string().min(1),
  supplier: z.string().min(1),
  amount: z.coerce.number().min(0),
  currency: z.string().default("USD"),
  purchaseDate: z.string(), // ISO date string
  note: z.string().nullable().optional(),
  attachments: z.array(z.string()).optional(),
});

export const purchaseOrderUpdateSchema = z.object({
  poNumber: z.string().min(1).optional(),
  supplier: z.string().min(1).optional(),
  amount: z.coerce.number().min(0).optional(),
  currency: z.string().optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "RECEIVED", "CANCELLED"]).optional(),
  purchaseDate: z.string().optional(),
  note: z.string().nullable().optional(),
  attachments: z.array(z.string()).optional(),
});
