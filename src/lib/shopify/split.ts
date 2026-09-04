/**
 * Split an order's Shopify Fulfillment Orders so that each local "group"
 * of line items ends up in its own Fulfillment Order. This lets us fulfill
 * (and add tracking to) each group independently — e.g. blanks shipped from
 * the factory vs. transfers shipped in-house.
 *
 * Uses the GraphQL Admin API `fulfillmentOrderSplit` mutation, which splits
 * the fulfillment-order structure WITHOUT fulfilling anything (no shipment,
 * no print impact). The rest of the app still fulfills via REST per group.
 *
 * Requires the `write_merchant_managed_fulfillment_orders` access scope.
 */

import { shopifyGraphql as graphql } from "./graphql";

/** Extract the numeric id from a Shopify gid (gid://shopify/Type/123 -> "123"). */
function numericId(gid: string): string {
  const m = gid.match(/\/(\d+)(?:\?|$)/);
  return m ? m[1] : gid;
}

interface FoLineItem {
  id: string; // gid of the FulfillmentOrderLineItem
  remainingQuantity: number;
  shopifyLineItemId: string; // numeric id of the underlying order line item
}

interface FulfillmentOrderNode {
  id: string; // gid of the FulfillmentOrder
  status: string;
  lineItems: FoLineItem[];
}

const FO_QUERY = `
  query orderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 50) {
        nodes {
          id
          status
          lineItems(first: 100) {
            nodes {
              id
              remainingQuantity
              lineItem { id }
            }
          }
        }
      }
    }
  }
`;

async function fetchFulfillmentOrders(
  shopifyOrderId: string
): Promise<FulfillmentOrderNode[]> {
  const data = await graphql<{
    order: {
      fulfillmentOrders: {
        nodes: Array<{
          id: string;
          status: string;
          lineItems: {
            nodes: Array<{
              id: string;
              remainingQuantity: number;
              lineItem: { id: string };
            }>;
          };
        }>;
      };
    } | null;
  }>(FO_QUERY, { id: `gid://shopify/Order/${shopifyOrderId}` });

  if (!data.order) {
    throw new Error(`Shopify order ${shopifyOrderId} not found`);
  }

  return data.order.fulfillmentOrders.nodes.map((fo) => ({
    id: fo.id,
    status: fo.status,
    lineItems: fo.lineItems.nodes.map((li) => ({
      id: li.id,
      remainingQuantity: li.remainingQuantity,
      shopifyLineItemId: numericId(li.lineItem.id),
    })),
  }));
}

/** Per-fulfillment-order info needed to sync split groups from Shopify. */
export interface FulfillmentGroupInfo {
  /** Numeric fulfillment order id (string). */
  foId: string;
  status: string;
  /** Delivery method shown in the Shopify admin, e.g. "Express". */
  deliveryMethodName: string | null;
  /** Numeric ids of the order line items in this fulfillment order. */
  shopifyLineItemIds: string[];
}

const FO_DELIVERY_QUERY = `
  query orderFulfillmentGroups($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 50) {
        nodes {
          id
          status
          deliveryMethod { methodType presentedName }
          lineItems(first: 100) {
            nodes { lineItem { id } }
          }
        }
      }
    }
  }
`;

/**
 * Fetch the order's fulfillment orders with their delivery method names.
 * Used to sync natively split orders (multiple shipping profiles at checkout)
 * so each group's Standard/Express method is known locally.
 */
export async function fetchFulfillmentGroupInfo(
  shopifyOrderId: string
): Promise<FulfillmentGroupInfo[]> {
  const data = await graphql<{
    order: {
      fulfillmentOrders: {
        nodes: Array<{
          id: string;
          status: string;
          deliveryMethod: {
            methodType: string | null;
            presentedName: string | null;
          } | null;
          lineItems: { nodes: Array<{ lineItem: { id: string } }> };
        }>;
      };
    } | null;
  }>(FO_DELIVERY_QUERY, { id: `gid://shopify/Order/${shopifyOrderId}` });

  if (!data.order) {
    throw new Error(`Shopify order ${shopifyOrderId} not found`);
  }

  return data.order.fulfillmentOrders.nodes.map((fo) => ({
    foId: numericId(fo.id),
    status: fo.status,
    deliveryMethodName: fo.deliveryMethod?.presentedName || null,
    shopifyLineItemIds: fo.lineItems.nodes.map((li) => numericId(li.lineItem.id)),
  }));
}

const SPLIT_MUTATION = `
  mutation foSplit($splits: [FulfillmentOrderSplitInput!]!) {
    fulfillmentOrderSplit(fulfillmentOrderSplits: $splits) {
      fulfillmentOrderSplits {
        fulfillmentOrder { id }
        remainingFulfillmentOrder { id }
      }
      userErrors { field message }
    }
  }
`;

/** A FulfillmentOrder can only be split while it is still open/actionable. */
function isSplittable(status: string): boolean {
  return status === "OPEN" || status === "IN_PROGRESS" || status === "SCHEDULED";
}

export interface SplitGroup {
  /** Shopify line item ids (numeric strings) that should be fulfilled together. */
  shopifyLineItemIds: string[];
}

/**
 * Rearrange the order's fulfillment orders so each group's line items live in
 * their own fulfillment order. Returns a map of shopifyLineItemId -> resulting
 * fulfillment order id (numeric string), suitable for persisting on OrderItem.
 */
export async function splitFulfillmentOrders(
  shopifyOrderId: string,
  groups: SplitGroup[]
): Promise<Record<string, string>> {
  // group index for each line item
  const groupOf = new Map<string, number>();
  groups.forEach((g, idx) => {
    for (const id of g.shopifyLineItemIds) groupOf.set(id, idx);
  });

  // Iteratively split: each pass finds one fulfillment order that still mixes
  // multiple groups and splits ONE group out of it. We re-fetch after every
  // mutation because a split can replace line-item / fulfillment-order ids.
  const MAX_PASSES = 30;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const fos = await fetchFulfillmentOrders(shopifyOrderId);

    let target: { fo: FulfillmentOrderNode; keepGroup: number; splitGroup: number } | null =
      null;

    for (const fo of fos) {
      if (!isSplittable(fo.status)) continue;
      const present = new Set<number>();
      for (const li of fo.lineItems) {
        const g = groupOf.get(li.shopifyLineItemId);
        if (g !== undefined) present.add(g);
      }
      if (present.size > 1) {
        const sorted = [...present].sort((a, b) => a - b);
        // keep the lowest-index group in place, split out the next one
        target = { fo, keepGroup: sorted[0], splitGroup: sorted[1] };
        break;
      }
    }

    if (!target) break; // every fulfillment order is now single-group

    const lineItemsToMove = target.fo.lineItems
      .filter(
        (li) =>
          groupOf.get(li.shopifyLineItemId) === target!.splitGroup &&
          li.remainingQuantity > 0
      )
      .map((li) => ({ id: li.id, quantity: li.remainingQuantity }));

    const result = await graphql<{
      fulfillmentOrderSplit: {
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(SPLIT_MUTATION, {
      splits: [
        {
          fulfillmentOrderId: target.fo.id,
          fulfillmentOrderLineItems: lineItemsToMove,
        },
      ],
    });

    const errors = result.fulfillmentOrderSplit.userErrors;
    if (errors && errors.length > 0) {
      throw new Error(
        `fulfillmentOrderSplit failed: ${errors.map((e) => e.message).join("; ")}`
      );
    }
  }

  // Build the final mapping shopifyLineItemId -> fulfillment order id
  const finalFos = await fetchFulfillmentOrders(shopifyOrderId);
  const mapping: Record<string, string> = {};
  for (const fo of finalFos) {
    for (const li of fo.lineItems) {
      mapping[li.shopifyLineItemId] = numericId(fo.id);
    }
  }
  return mapping;
}
