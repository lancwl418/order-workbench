import { createShopifyRestClient } from "./client";

/**
 * Push a fulfillment (tracking number + carrier) back to Shopify
 * via the REST Admin API.
 *
 * This creates a new fulfillment on the Shopify order, which will
 * mark the order as fulfilled and notify the customer.
 *
 * @param shopifyOrderId - The Shopify order ID (numeric string)
 * @param trackingNumber - The tracking number to send
 * @param carrier        - The shipping carrier name (e.g. "USPS", "UPS", "FedEx")
 * @param trackingUrl    - Optional tracking URL
 * @param notify         - Whether to notify the customer (default: true)
 */
export async function pushFulfillmentToShopify(params: {
  shopifyOrderId: string;
  trackingNumber: string;
  carrier: string;
  trackingUrl?: string;
  notify?: boolean;
}): Promise<{
  fulfillmentId: string;
  status: string;
}> {
  const client = createShopifyRestClient();

  // First, get the fulfillment orders for this order to find the
  // fulfillment_order_id (required by Shopify API)
  const fulfillmentOrdersResponse = await client.get({
    path: `orders/${params.shopifyOrderId}/fulfillment_orders`,
  });

  const fulfillmentOrdersBody = fulfillmentOrdersResponse.body as {
    fulfillment_orders: Array<{
      id: number;
      status: string;
      line_items: Array<{
        id: number;
        fulfillable_quantity: number;
      }>;
    }>;
  };

  // Find open fulfillment orders
  const openFulfillmentOrders =
    fulfillmentOrdersBody.fulfillment_orders.filter(
      (fo) => fo.status === "open" || fo.status === "in_progress"
    );

  if (openFulfillmentOrders.length === 0) {
    throw new Error(
      `No open fulfillment orders found for Shopify order ${params.shopifyOrderId}`
    );
  }

  // Build line_items_by_fulfillment_order for the fulfillment request
  const lineItemsByFulfillmentOrder = openFulfillmentOrders.map((fo) => ({
    fulfillment_order_id: fo.id,
    fulfillment_order_line_items: fo.line_items
      .filter((li) => li.fulfillable_quantity > 0)
      .map((li) => ({
        id: li.id,
        quantity: li.fulfillable_quantity,
      })),
  }));

  // Create the fulfillment
  const fulfillmentResponse = await client.post({
    path: "fulfillments",
    data: {
      fulfillment: {
        line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
        tracking_info: {
          number: params.trackingNumber,
          company: params.carrier,
          url: params.trackingUrl || undefined,
        },
        notify_customer: params.notify !== false,
      },
    },
  });

  const fulfillmentBody = fulfillmentResponse.body as {
    fulfillment: {
      id: number;
      status: string;
    };
  };

  return {
    fulfillmentId: String(fulfillmentBody.fulfillment.id),
    status: fulfillmentBody.fulfillment.status,
  };
}
