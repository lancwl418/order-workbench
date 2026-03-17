/**
 * Push a fulfillment (tracking number + carrier) back to Shopify
 * via the REST Admin API using raw fetch (consistent with fetchOrders).
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
  const store = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN!;
  const version = process.env.SHOPIFY_API_VERSION || "2025-01";
  const baseUrl = `https://${store}/admin/api/${version}`;

  // First, get the fulfillment orders for this order to find the
  // fulfillment_order_id (required by Shopify API)
  const foRes = await fetch(
    `${baseUrl}/orders/${params.shopifyOrderId}/fulfillment_orders.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  if (!foRes.ok) {
    const errText = await foRes.text();
    console.error(
      `[Shopify] GET fulfillment_orders failed: status=${foRes.status} body=${errText}`
    );
    throw new Error(
      `Shopify API error ${foRes.status} fetching fulfillment orders for order ${params.shopifyOrderId}`
    );
  }

  const foData = (await foRes.json()) as {
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
  const allStatuses = foData.fulfillment_orders.map(
    (fo) => `${fo.id}:${fo.status}`
  );
  console.log(
    `[Shopify] GET fulfillment_orders for order ${params.shopifyOrderId}: status=${foRes.status} count=${foData.fulfillment_orders.length} [${allStatuses.join(", ")}]`
  );

  // Find fulfillable orders — accept open, in_progress, or scheduled
  const fulfillableOrders = foData.fulfillment_orders.filter(
    (fo) =>
      fo.status === "open" ||
      fo.status === "in_progress" ||
      fo.status === "scheduled"
  );

  if (fulfillableOrders.length > 0) {
    // Create a new fulfillment
    return createFulfillment(baseUrl, token, fulfillableOrders, params);
  }

  // No fulfillable orders — order may already be fulfilled.
  // Try to update tracking on an existing fulfillment instead.
  console.log(
    `[Shopify] No fulfillable orders for order ${params.shopifyOrderId}, checking existing fulfillments...`
  );

  return updateExistingFulfillmentTracking(baseUrl, token, params);
}

async function createFulfillment(
  baseUrl: string,
  token: string,
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

  const body = {
    fulfillment: {
      line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
      tracking_info: {
        number: params.trackingNumber,
        company: params.carrier,
        url: params.trackingUrl || undefined,
      },
      notify_customer: params.notify !== false,
    },
  };

  const res = await fetch(`${baseUrl}/fulfillments.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(
      `[Shopify] POST fulfillments failed: status=${res.status} body=${errText}`
    );
    throw new Error(
      `Shopify API error ${res.status} creating fulfillment: ${errText}`
    );
  }

  const data = (await res.json()) as {
    fulfillment: { id: number; status: string };
  };

  console.log(
    `[Shopify] Fulfillment created: id=${data.fulfillment.id} status=${data.fulfillment.status}`
  );

  return {
    fulfillmentId: String(data.fulfillment.id),
    status: data.fulfillment.status,
  };
}

async function updateExistingFulfillmentTracking(
  baseUrl: string,
  token: string,
  params: {
    shopifyOrderId: string;
    trackingNumber: string;
    carrier: string;
    trackingUrl?: string;
    notify?: boolean;
  }
) {
  // Get existing fulfillments for this order
  const listRes = await fetch(
    `${baseUrl}/orders/${params.shopifyOrderId}/fulfillments.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  if (!listRes.ok) {
    const errText = await listRes.text();
    console.error(
      `[Shopify] GET fulfillments failed: status=${listRes.status} body=${errText}`
    );
    throw new Error(
      `Shopify API error ${listRes.status} fetching fulfillments for order ${params.shopifyOrderId}`
    );
  }

  const listData = (await listRes.json()) as {
    fulfillments: Array<{
      id: number;
      status: string;
      tracking_number: string | null;
    }>;
  };

  console.log(
    `[Shopify] Existing fulfillments for order ${params.shopifyOrderId}: count=${listData.fulfillments.length}`
  );

  if (listData.fulfillments.length === 0) {
    throw new Error(
      `No fulfillments found for Shopify order ${params.shopifyOrderId}. The order may not have any fulfillment orders.`
    );
  }

  // Prefer a fulfillment without tracking, otherwise use the first one
  const target =
    listData.fulfillments.find((f) => !f.tracking_number) ||
    listData.fulfillments[0];

  console.log(
    `[Shopify] Updating tracking on existing fulfillment ${target.id} (status: ${target.status})`
  );

  const body = {
    fulfillment: {
      tracking_info: {
        number: params.trackingNumber,
        company: params.carrier,
        url: params.trackingUrl || undefined,
      },
      notify_customer: params.notify !== false,
    },
  };

  // Update tracking info on the existing fulfillment
  const updateRes = await fetch(
    `${baseUrl}/fulfillments/${target.id}/update_tracking.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error(
      `[Shopify] POST update_tracking failed: status=${updateRes.status} body=${errText}`
    );
    throw new Error(
      `Shopify API error ${updateRes.status} updating tracking: ${errText}`
    );
  }

  const updateData = (await updateRes.json()) as {
    fulfillment: { id: number; status: string };
  };

  return {
    fulfillmentId: String(updateData.fulfillment.id),
    status: updateData.fulfillment.status,
  };
}
