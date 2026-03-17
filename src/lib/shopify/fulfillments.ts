import { createShopifyRestClient } from "./client";

/**
 * Push a fulfillment (tracking number + carrier) back to Shopify
 * via the REST Admin API.
 *
 * If open fulfillment orders exist, creates a new fulfillment.
 * If the order is already fulfilled, updates tracking on the
 * existing fulfillment instead.
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

  // Log all fulfillment order statuses for debugging
  const allStatuses = fulfillmentOrdersBody.fulfillment_orders.map(
    (fo) => `${fo.id}:${fo.status}`
  );
  console.log(
    `Fulfillment orders for Shopify order ${params.shopifyOrderId}: [${allStatuses.join(", ")}]`
  );

  // Find fulfillable orders — accept open, in_progress, or scheduled
  const fulfillableOrders =
    fulfillmentOrdersBody.fulfillment_orders.filter(
      (fo) =>
        fo.status === "open" ||
        fo.status === "in_progress" ||
        fo.status === "scheduled"
    );

  if (fulfillableOrders.length > 0) {
    // Create a new fulfillment
    return createFulfillment(client, fulfillableOrders, params);
  }

  // No fulfillable orders — order may already be fulfilled.
  // Try to update tracking on an existing fulfillment instead.
  console.log(
    `No fulfillable orders for Shopify order ${params.shopifyOrderId}, checking existing fulfillments...`
  );

  return updateExistingFulfillmentTracking(client, params);
}

async function createFulfillment(
  client: ReturnType<typeof createShopifyRestClient>,
  openFulfillmentOrders: Array<{
    id: number;
    line_items: Array<{ id: number; fulfillable_quantity: number }>;
  }>,
  params: {
    trackingNumber: string;
    carrier: string;
    trackingUrl?: string;
    notify?: boolean;
  }
) {
  const lineItemsByFulfillmentOrder = openFulfillmentOrders.map((fo) => ({
    fulfillment_order_id: fo.id,
    fulfillment_order_line_items: fo.line_items
      .filter((li) => li.fulfillable_quantity > 0)
      .map((li) => ({
        id: li.id,
        quantity: li.fulfillable_quantity,
      })),
  }));

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
    fulfillment: { id: number; status: string };
  };

  return {
    fulfillmentId: String(fulfillmentBody.fulfillment.id),
    status: fulfillmentBody.fulfillment.status,
  };
}

async function updateExistingFulfillmentTracking(
  client: ReturnType<typeof createShopifyRestClient>,
  params: {
    shopifyOrderId: string;
    trackingNumber: string;
    carrier: string;
    trackingUrl?: string;
    notify?: boolean;
  }
) {
  // Get existing fulfillments for this order
  const fulfillmentsResponse = await client.get({
    path: `orders/${params.shopifyOrderId}/fulfillments`,
  });

  const fulfillmentsBody = fulfillmentsResponse.body as {
    fulfillments: Array<{
      id: number;
      status: string;
      tracking_number: string | null;
    }>;
  };

  if (fulfillmentsBody.fulfillments.length === 0) {
    throw new Error(
      `No fulfillments found for Shopify order ${params.shopifyOrderId}. The order may not have any fulfillment orders.`
    );
  }

  // Prefer a fulfillment without tracking, otherwise use the first one
  const target =
    fulfillmentsBody.fulfillments.find((f) => !f.tracking_number) ||
    fulfillmentsBody.fulfillments[0];

  console.log(
    `Updating tracking on existing fulfillment ${target.id} (status: ${target.status})`
  );

  // Update tracking info on the existing fulfillment
  const updateResponse = await client.post({
    path: `fulfillments/${target.id}/update_tracking`,
    data: {
      fulfillment: {
        tracking_info: {
          number: params.trackingNumber,
          company: params.carrier,
          url: params.trackingUrl || undefined,
        },
        notify_customer: params.notify !== false,
      },
    },
  });

  const updateBody = updateResponse.body as {
    fulfillment: { id: number; status: string };
  };

  return {
    fulfillmentId: String(updateBody.fulfillment.id),
    status: updateBody.fulfillment.status,
  };
}
