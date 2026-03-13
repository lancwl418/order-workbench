import { Prisma } from "@prisma/client";
import { createShopifyRestClient } from "./client";
import type {
  ShopifyOrder,
  ShopifyLineItem,
  MappedOrder,
  MappedOrderItem,
  MappedFulfillment,
} from "./types";

/**
 * Fetch orders from Shopify REST Admin API.
 *
 * @param params.status       - Filter by order status (default: "any")
 * @param params.limit        - Number of orders per page (default: 50, max: 250)
 * @param params.sinceId      - Only return orders after the given ID
 * @param params.createdAtMin - Only return orders created after this ISO date
 * @param params.updatedAtMin - Only return orders updated after this ISO date
 */
export async function fetchOrders(params?: {
  status?: string;
  limit?: number;
  sinceId?: string;
  createdAtMin?: string;
  updatedAtMin?: string;
}): Promise<ShopifyOrder[]> {
  const client = createShopifyRestClient();

  const query: Record<string, string | number> = {
    status: params?.status || "any",
    limit: params?.limit || 50,
  };

  if (params?.sinceId) {
    query.since_id = params.sinceId;
  }
  if (params?.createdAtMin) {
    query.created_at_min = params.createdAtMin;
  }
  if (params?.updatedAtMin) {
    query.updated_at_min = params.updatedAtMin;
  }

  const response = await client.get({
    path: "orders",
    query,
  });

  const body = response.body as { orders: ShopifyOrder[] };
  return body.orders;
}

/**
 * Fetch a single order by its Shopify ID.
 */
export async function fetchOrderById(
  shopifyOrderId: string
): Promise<ShopifyOrder> {
  const client = createShopifyRestClient();

  const response = await client.get({
    path: `orders/${shopifyOrderId}`,
  });

  const body = response.body as { order: ShopifyOrder };
  return body.order;
}

/**
 * Transform a Shopify order into our internal Order model shape.
 * Returns the mapped order data and its line items separately
 * so they can be upserted in a transaction.
 */
export function transformShopifyOrder(shopifyOrder: ShopifyOrder): {
  order: MappedOrder;
  items: MappedOrderItem[];
  fulfillments: MappedFulfillment[];
} {
  const customer = shopifyOrder.customer;
  const shippingAddress = shopifyOrder.shipping_address || null;

  // Build customer name from customer object or shipping address
  let customerName: string | null = null;
  if (customer?.first_name || customer?.last_name) {
    customerName = [customer.first_name, customer.last_name]
      .filter(Boolean)
      .join(" ");
  } else if (shippingAddress?.name) {
    customerName = shippingAddress.name;
  }

  // Determine shipping method from the first shipping line
  const shippingMethod =
    shopifyOrder.shipping_lines?.[0]?.title || null;

  // Map Shopify fulfillment/financial status to internal workflow status
  const internalStatus = mapShopifyToInternalStatus(
    shopifyOrder.fulfillment_status,
    shopifyOrder.financial_status,
    shopifyOrder.cancelled_at
  );

  const order: MappedOrder = {
    shopifyOrderId: String(shopifyOrder.id),
    shopifyOrderNumber: shopifyOrder.name,
    shopifyStatus: shopifyOrder.financial_status,
    shopifyFulfillStatus: shopifyOrder.fulfillment_status || null,
    shopifyCreatedAt: new Date(shopifyOrder.created_at),
    shopifyUpdatedAt: new Date(shopifyOrder.updated_at),
    shopifyRawJson: JSON.parse(JSON.stringify(shopifyOrder)) as Prisma.InputJsonValue,
    customerName,
    customerEmail: shopifyOrder.email || customer?.email || null,
    customerPhone:
      shopifyOrder.phone ||
      customer?.phone ||
      shippingAddress?.phone ||
      null,
    shippingAddress: shippingAddress
      ? (JSON.parse(JSON.stringify(shippingAddress)) as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    totalPrice: shopifyOrder.total_price,
    currency: shopifyOrder.currency,
    shippingMethod,
    internalStatus,
  };

  // Product IDs for print-ready URL extraction (compared as strings for safety)
  const TRANSFER_BY_SIZE_PRODUCT_ID = "9000096399595";
  const BUILD_A_GANGSHEET_PRODUCT_ID = "8999852835051";

  // For Transfer by Size: only grab one _Print Ready URL per order
  let transferBySizePrintUrl: string | null = null;

  const items: MappedOrderItem[] = shopifyOrder.line_items.map(
    (lineItem: ShopifyLineItem) => {
      let designFileUrl: string | null = null;
      const productId = String(lineItem.product_id || "");

      if (productId === TRANSFER_BY_SIZE_PRODUCT_ID) {
        // Transfer by Size: one shared print-ready URL per order
        if (!transferBySizePrintUrl) {
          transferBySizePrintUrl = lineItem.properties
            ?.find((p) => p.name === "_Print Ready")?.value || null;
        }
        designFileUrl = transferBySizePrintUrl;
      } else if (productId === BUILD_A_GANGSHEET_PRODUCT_ID) {
        // Build a Gangsheet: each line item has its own URL
        designFileUrl = lineItem.properties
          ?.find((p) => p.name === "_Print Ready File")?.value || null;
      }

      return {
        shopifyLineItemId: String(lineItem.id),
        title: lineItem.title,
        variantTitle: lineItem.variant_title || null,
        sku: lineItem.sku || null,
        quantity: lineItem.quantity,
        price: lineItem.price,
        designFileUrl,
      };
    }
  );

  // Extract fulfillment/tracking data
  const fulfillments: MappedFulfillment[] = (shopifyOrder.fulfillments || [])
    .filter((f) => f.tracking_number || f.tracking_numbers?.[0])
    .map((f) => ({
      shopifyFulfillmentId: String(f.id),
      trackingNumber: f.tracking_number || f.tracking_numbers?.[0] || null,
      trackingUrl: f.tracking_url || f.tracking_urls?.[0] || null,
      carrier: f.tracking_company || null,
      status: f.status,
      shipmentStatus: f.shipment_status || null,
      shippedAt: new Date(f.created_at),
    }));

  return { order, items, fulfillments };
}

/**
 * Map Shopify fulfillment + financial status to our internal workflow status.
 *
 * Mapping logic:
 * - cancelled → CANCELLED
 * - refunded/voided → CANCELLED
 * - fulfilled → SHIPPED
 * - partial → READY_TO_SHIP
 * - unfulfilled + paid → READY_TO_PRINT
 * - unfulfilled + pending → NEW
 */
function mapShopifyToInternalStatus(
  fulfillmentStatus: string | null,
  financialStatus: string,
  cancelledAt?: string | null
): MappedOrder["internalStatus"] {
  // Cancelled in Shopify
  if (cancelledAt) {
    return "CANCELLED";
  }

  // Refunded or voided - treat as cancelled
  if (financialStatus === "refunded" || financialStatus === "voided") {
    return "CANCELLED";
  }

  // Already fulfilled in Shopify
  if (fulfillmentStatus === "fulfilled") {
    return "SHIPPED";
  }

  // Partially fulfilled
  if (fulfillmentStatus === "partial") {
    return "READY_TO_SHIP";
  }

  // Unfulfilled - check payment status
  if (!fulfillmentStatus || fulfillmentStatus === "unfulfilled") {
    if (financialStatus === "paid" || financialStatus === "partially_paid") {
      return "READY_TO_PRINT";
    }
    // pending, authorized, partially_refunded
    return "NEW";
  }

  return "NEW";
}
