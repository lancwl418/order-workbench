/**
 * "Ready to Print" gang sheets: a transfer product whose artwork is a
 * pre-made gang sheet rather than a Drip-built one. Shopify identifies them
 * with the product tag `readyprint`.
 *
 * The sheet images live in metafields:
 * - variant `custom.ready_to_print_gangsheets` (list.url) — one entry per
 *   gang sheet of the purchased variant (a variant may have several);
 * - product `custom.transfer_file` (url) — legacy single-sheet products
 *   without per-variant sheets. Used only when the variant list is empty.
 *
 * Line items don't carry product tags or metafields, so classification is a
 * separate async pass over the mapped items (see applyReadyPrintItems).
 */

import { shopifyGraphql } from "./graphql";
import type { MappedOrderItem, ShopifyLineItem } from "./types";

export const READY_PRINT_TAG = "readyprint";
const METAFIELD_NAMESPACE = "custom";
const PRODUCT_METAFIELD_KEY = "transfer_file";
const VARIANT_METAFIELD_KEY = "ready_to_print_gangsheets";

export interface ReadyPrintInfo {
  isReadyPrint: boolean;
  /** Gang sheet URLs for the purchased variant; empty if none configured. */
  transferFileUrls: string[];
}

const METAFIELD_FIELDS = `
  type
  value
  reference {
    ... on GenericFile { url }
    ... on MediaImage { image { url } }
  }
  references(first: 20) {
    nodes {
      ... on GenericFile { url }
      ... on MediaImage { image { url } }
    }
  }
`;

const PRODUCT_QUERY = `
  query readyPrintProduct($productId: ID!, $namespace: String!, $productKey: String!) {
    product(id: $productId) {
      tags
      metafield(namespace: $namespace, key: $productKey) { ${METAFIELD_FIELDS} }
    }
  }
`;

const PRODUCT_VARIANT_QUERY = `
  query readyPrintProductVariant($productId: ID!, $variantId: ID!, $namespace: String!, $productKey: String!, $variantKey: String!) {
    product(id: $productId) {
      tags
      metafield(namespace: $namespace, key: $productKey) { ${METAFIELD_FIELDS} }
    }
    productVariant(id: $variantId) {
      metafield(namespace: $namespace, key: $variantKey) { ${METAFIELD_FIELDS} }
    }
  }
`;

interface MetafieldResult {
  type: string;
  value: string | null;
  reference:
    | { url?: string | null; image?: { url?: string | null } | null }
    | null;
  references: {
    nodes: Array<{ url?: string | null; image?: { url?: string | null } | null }>;
  } | null;
}

interface LookupQueryResult {
  product: {
    tags: string[];
    metafield: MetafieldResult | null;
  } | null;
  productVariant?: {
    metafield: MetafieldResult | null;
  } | null;
}

// Short-lived per-process cache: a sync of hundreds of orders hits the same
// few products, but merchants also edit the metafield and expect "Refresh"
// on the order page to pick it up, so don't cache for long.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { info: ReadyPrintInfo; at: number }>();

/**
 * Pull the usable URLs out of a metafield: file references, a list.url JSON
 * array, a single URL value, or plain text containing a URL.
 */
function metafieldUrls(mf: MetafieldResult | null | undefined): string[] {
  if (!mf) return [];

  const refUrls = (mf.references?.nodes || [])
    .map((n) => n.url || n.image?.url)
    .filter((u): u is string => Boolean(u));
  if (refUrls.length > 0) return refUrls;

  const refUrl = mf.reference?.url || mf.reference?.image?.url;
  if (refUrl) return [refUrl];

  const v = (mf.value || "").trim();
  if (!v) return [];

  // list.url metafields hold a JSON array of URLs
  if (v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed
          .map((u) => String(u).trim())
          .filter((u) => /^https?:\/\//i.test(u));
      }
    } catch {
      return [];
    }
  }

  return /^https?:\/\//i.test(v) ? [v] : [];
}

/**
 * Look up whether a product is a Ready to Print gang sheet and, if so, the
 * transfer file URLs for the purchased variant (variant metafield first,
 * product metafield as fallback). Never throws: lookup failures return
 * "not ready print" so a Shopify hiccup degrades to the pre-existing
 * classification.
 */
export async function getReadyPrintInfo(
  productId: string,
  variantId: string | null
): Promise<ReadyPrintInfo> {
  const cacheKey = `${productId}:${variantId || ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  let info: ReadyPrintInfo = { isReadyPrint: false, transferFileUrls: [] };
  try {
    const variables: Record<string, string> = {
      productId: `gid://shopify/Product/${productId}`,
      namespace: METAFIELD_NAMESPACE,
      productKey: PRODUCT_METAFIELD_KEY,
    };
    let query = PRODUCT_QUERY;
    if (variantId) {
      query = PRODUCT_VARIANT_QUERY;
      variables.variantId = `gid://shopify/ProductVariant/${variantId}`;
      variables.variantKey = VARIANT_METAFIELD_KEY;
    }

    const data = await shopifyGraphql<LookupQueryResult>(query, variables);
    const product = data.product;
    if (product) {
      const isReadyPrint = product.tags.some(
        (t) => t.trim().toLowerCase() === READY_PRINT_TAG
      );
      if (isReadyPrint) {
        const variantUrls = metafieldUrls(data.productVariant?.metafield);
        const urls =
          variantUrls.length > 0 ? variantUrls : metafieldUrls(product.metafield);
        info = { isReadyPrint, transferFileUrls: urls };
      }
    }
  } catch (e) {
    console.error(
      `Ready print lookup failed for product ${productId} variant ${variantId}:`,
      e
    );
    return info; // don't cache failures
  }

  cache.set(cacheKey, { info, at: Date.now() });
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
 * gang sheet URLs from the variant/product metafields. Mutates `items` in
 * place. Items already recognized as Transfer by Size / Build a Gangsheet /
 * Free Sample are left untouched.
 */
export async function applyReadyPrintItems(
  items: MappedOrderItem[],
  lineItems: ShopifyLineItem[]
): Promise<void> {
  const idsByLineItem = new Map<string, { productId: string; variantId: string | null }>();
  for (const li of lineItems) {
    if (li.product_id) {
      idsByLineItem.set(String(li.id), {
        productId: String(li.product_id),
        variantId: li.variant_id ? String(li.variant_id) : null,
      });
    }
  }

  for (const item of items) {
    if (!isReadyPrintCandidate(item)) continue;
    const ids = idsByLineItem.get(item.shopifyLineItemId);
    if (!ids) continue;

    const info = await getReadyPrintInfo(ids.productId, ids.variantId);
    if (!info.isReadyPrint) continue;

    item.itemType = "ready_print";
    item.designFileUrl = info.transferFileUrls[0] ?? null;
    item.designFileUrls = info.transferFileUrls;
  }
}
