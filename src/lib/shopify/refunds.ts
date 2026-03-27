import { createShopifyRestClient } from "./client";

/**
 * Create a full refund for a Shopify order.
 * 1. Calculates the refund (line items + shipping)
 * 2. Posts the refund with the calculated values
 */
export async function createFullRefund(
  shopifyOrderId: string
): Promise<{ refundId: string }> {
  const client = createShopifyRestClient();

  // Step 1: Calculate refund
  const calcResponse = await client.post({
    path: `orders/${shopifyOrderId}/refunds/calculate`,
    data: {
      refund: {
        currency: "USD",
      },
    },
  });

  const calculated = (calcResponse.body as { refund: Record<string, unknown> }).refund;

  // Step 2: Create the refund
  const refundResponse = await client.post({
    path: `orders/${shopifyOrderId}/refunds`,
    data: {
      refund: {
        currency: "USD",
        notify: true,
        shipping: calculated.shipping,
        refund_line_items: calculated.refund_line_items,
        transactions: calculated.transactions,
      },
    },
  });

  const refund = (refundResponse.body as { refund: { id: number } }).refund;
  return { refundId: String(refund.id) };
}
