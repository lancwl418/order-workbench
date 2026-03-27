import { createShopifyRestClient } from "./client";
import { fetchOrderById } from "./orders";

const RESHIP_TAGS = "customerservice, reship, shipping issue";

const SHIPPING_METHODS: Record<string, { title: string; price: string }> = {
  standard: { title: "Standard Shipping", price: "0.00" },
  express: { title: "Express Shipping", price: "0.00" },
};

type ReshipParams = {
  shopifyOrderId: string;
  shippingMethod: "express" | "standard";
  note?: string;
};

/**
 * Create a reship order via Shopify Draft Orders API.
 *
 * 1. Fetches original order to get line items with variant_id
 * 2. Creates a draft order with tags, discount, and shipping
 * 3. Completes the draft order (marks as paid)
 */
export async function createReshipOrder(
  params: ReshipParams
): Promise<{ orderId: string; orderNumber: string; orderName: string }> {
  const client = createShopifyRestClient();

  // Fetch original order for line items
  const originalOrder = await fetchOrderById(params.shopifyOrderId);

  // Build line items from original order
  const lineItems = originalOrder.line_items.map((item) => ({
    variant_id: item.variant_id,
    quantity: item.quantity,
  }));

  const shipping = SHIPPING_METHODS[params.shippingMethod] || SHIPPING_METHODS.standard;

  // Build note
  const noteLines: string[] = [];
  if (params.note) noteLines.push(params.note);
  noteLines.push(`Reship for original order ${originalOrder.name || `#${originalOrder.order_number}`}`);
  const note = noteLines.join("\n");

  // Step 1: Create draft order
  const draftResponse = await client.post({
    path: "draft_orders",
    data: {
      draft_order: {
        line_items: lineItems,
        shipping_address: originalOrder.shipping_address,
        shipping_line: {
          title: shipping.title,
          price: shipping.price,
        },
        tags: RESHIP_TAGS,
        note,
        applied_discount: {
          title: "customerservice",
          description: "Customer service reship discount",
          value_type: "percentage",
          value: "100.0",
        },
        use_customer_default_address: false,
        customer: originalOrder.customer
          ? { id: originalOrder.customer.id }
          : undefined,
      },
    },
  });

  const draftOrder = (draftResponse.body as { draft_order: { id: number } }).draft_order;

  // Step 2: Complete draft order (mark as paid)
  const completeResponse = await client.put({
    path: `draft_orders/${draftOrder.id}/complete`,
    data: {
      payment_pending: false,
    },
  });

  const completedDraft = (completeResponse.body as {
    draft_order: { order_id: number; name: string; order: { id: number; order_number: number; name: string } };
  }).draft_order;

  return {
    orderId: String(completedDraft.order_id),
    orderNumber: String(completedDraft.order?.order_number || ""),
    orderName: completedDraft.order?.name || completedDraft.name || "",
  };
}
