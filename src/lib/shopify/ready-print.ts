/**
 * "Ready to Print" gang sheets: a transfer product whose artwork is a
 * pre-made gang sheet rather than a Drip-built one. Shopify identifies them
 * with the product tag `readyprint`; the sheet image lives in the product
 * metafield `custom.transfer_file`.
 *
 * Line items don't carry product tags or metafields, so classification is a
 * separate async pass over the mapped items (see applyReadyPrintItems).
 */

import { shopifyGraphql } from "./graphql";
import type { MappedOrderItem, ShopifyLineItem } from "./types";

export const READY_PRINT_TAG = "readyprint";
const METAFIELD_NAMESPACE = "custom";
const METAFIELD_KEY = "transfer_file";

export interface ReadyPrintProductInfo {
  isReadyPrint: boolean;
  transferFileUrl: string | null;
}

const PRODUCT_QUERY = `
  query readyPrintProduct($id: ID!, $namespace: String!, $key: String!) {
    product(id: $id) {
      tags
      metafield(namespace: $namespace, key: $key) {
        type
        value
        reference {
          ... on GenericFile { url }
          ... on MediaImage { image { url } }
        }
      }
    }
  }
`;

interface ProductQueryResult {
  product: {
    tags: string[];
    metafield: {
      type: string;
      value: string | null;
      reference:
        | { url?: string | null; image?: { url?: string | null } | null }
        | null;
    } | null;
  } | null;
}

// Short-lived per-process cache: a sync of hundreds of orders hits the same
// few products, but merchants also edit the metafield and expect "Refresh"
// on the order page to pick it up, so don't cache for long.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { info: ReadyPrintProductInfo; at: number }>();

/** Pull a usable URL out of the metafield: file reference, URL type, or plain text. */
function metafieldUrl(mf: NonNullable<ProductQueryResult["product"]>["metafield"]): string | null {
  if (!mf) return null;
  const refUrl = mf.reference?.url || mf.reference?.image?.url;
  if (refUrl) return refUrl;
  const v = (mf.value || "").trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

/**
 * Look up whether a product is a Ready to Print gang sheet and, if so, the
 * transfer file URL. Never throws: lookup failures return "not ready print"
 * so a Shopify hiccup degrades to the pre-existing classification.
 */
export async function getReadyPrintProductInfo(
  productId: string
): Promise<ReadyPrintProductInfo> {
  const hit = cache.get(productId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  let info: ReadyPrintProductInfo = { isReadyPrint: false, transferFileUrl: null };
  try {
    const data = await shopifyGraphql<ProductQueryResult>(PRODUCT_QUERY, {
      id: `gid://shopify/Product/${productId}`,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
    });
    const product = data.product;
    if (product) {
      const isReadyPrint = product.tags.some(
        (t) => t.trim().toLowerCase() === READY_PRINT_TAG
      );
      info = {
        isReadyPrint,
        transferFileUrl: isReadyPrint ? metafieldUrl(product.metafield) : null,
      };
    }
  } catch (e) {
    console.error(`Ready print lookup failed for product ${productId}:`, e);
    return info; // don't cache failures
  }

  cache.set(productId, { info, at: Date.now() });
  return info;
}

/** For tests / manual refreshes. */
export function clearReadyPrintCache(): void {
  cache.clear();
}

/**
 * Items the product-ID / property based classification could not resolve to
 * a print file: plain "other" items, or title-fallback "gangsheet" items
 * without a `_Print Ready File` property (a Ready to Print product is usually
 * titled "... Gang Sheet", so it lands there).
 */
function isReadyPrintCandidate(item: MappedOrderItem): boolean {
  if (item.itemType === "other") return true;
  return item.itemType === "gangsheet" && !item.designFileUrl;
}

/**
 * Second classification pass: mark Ready to Print line items and attach the
 * gang sheet URL from the product metafield. Mutates `items` in place.
 * Items already recognized as Transfer by Size / Build a Gangsheet / Free
 * Sample are left untouched.
 */
export async function applyReadyPrintItems(
  items: MappedOrderItem[],
  lineItems: ShopifyLineItem[]
): Promise<void> {
  const productByLineItem = new Map<string, string>();
  for (const li of lineItems) {
    if (li.product_id) productByLineItem.set(String(li.id), String(li.product_id));
  }

  for (const item of items) {
    if (!isReadyPrintCandidate(item)) continue;
    const productId = productByLineItem.get(item.shopifyLineItemId);
    if (!productId) continue;

    const info = await getReadyPrintProductInfo(productId);
    if (!info.isReadyPrint) continue;

    item.itemType = "ready_print";
    item.designFileUrl = info.transferFileUrl;
  }
}
