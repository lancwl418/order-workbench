/**
 * Type definitions for Shopify REST Admin API order shape
 * and mappings to our internal Order / OrderItem models.
 */

import type { Prisma } from "@prisma/client";

// ─── Shopify REST API Types ─────────────────────────────────────

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  country?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
  name?: string;
}

export interface ShopifyCustomer {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  default_address?: ShopifyAddress;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  variant_title?: string;
  sku?: string;
  quantity: number;
  price: string;
  product_id?: number;
  variant_id?: number;
  fulfillable_quantity: number;
  fulfillment_status?: string | null;
  properties?: Array<{ name: string; value: string }>;
}

export interface ShopifyShippingLine {
  title: string;
  code?: string;
  price: string;
  source?: string;
}

export interface ShopifyFulfillment {
  id: number;
  order_id: number;
  status: string;
  /** Shipment transit status: confirmed, in_transit, out_for_delivery, delivered, failure */
  shipment_status?: string | null;
  tracking_number?: string;
  tracking_numbers?: string[];
  tracking_url?: string;
  tracking_urls?: string[];
  tracking_company?: string;
  line_items: ShopifyLineItem[];
  created_at: string;
  updated_at: string;
}

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string; // e.g. "#1001"
  email?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  customer?: ShopifyCustomer;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  shipping_lines?: ShopifyShippingLine[];
  fulfillments?: ShopifyFulfillment[];
  note?: string;
  tags?: string;
  cancelled_at?: string | null;
  closed_at?: string | null;
}

// ─── Internal Mapped Types ──────────────────────────────────────

/** Data shape for upserting an Order via Prisma */
export interface MappedOrder {
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  shopifyStatus: string;
  shopifyFulfillStatus: string | null;
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  shopifyRawJson: Prisma.InputJsonValue;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  totalPrice: string; // Decimal as string for Prisma
  currency: string;
  shippingMethod: string | null;
  internalStatus: "OPEN" | "REVIEW" | "LABEL_CREATED" | "SHIPPED" | "DELIVERED" | "DELAYED" | "CANCELLED" | "DISMISSED";
  tags: string[];
  notes: string | null;
}

/** Data shape for creating a Shipment from Shopify fulfillment */
export interface MappedFulfillment {
  shopifyFulfillmentId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  status: string;
  shipmentStatus: string | null;
  shippedAt: Date;
}

/** Data shape for creating an OrderItem via Prisma */
export interface MappedOrderItem {
  shopifyLineItemId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  price: string; // Decimal as string for Prisma
  designFileUrl: string | null;
}
