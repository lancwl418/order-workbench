/**
 * Printed apparel: garments we have the factory print and ship (vs blanks,
 * which go out unprinted). Shopify identifies them with the product type
 * "Printed Apparel" (matched case/space-insensitively).
 *
 * Push inputs live on the product:
 * - design file: metafield `custom.print_image` (variant first, product
 *   fallback) — becomes the factory print image;
 * - mockup / finished-garment image: the variant image, falling back to the
 *   product's featured image — becomes the factory effect image.
 *
 * Line items don't carry the product type or metafields, so classification
 * is a separate async pass over the mapped items (same pattern as
 * applyReadyPrintItems in ready-print.ts).
 */

import { shopifyGraphql } from "./graphql";
import { metafieldUrls, type MetafieldResult } from "./ready-print";
import type { MappedOrderItem, ShopifyLineItem } from "./types";

export const PRINTED_APPAREL_PRODUCT_TYPE = "printed apparel";
const METAFIELD_NAMESPACE = "custom";
const PRINT_IMAGE_KEY = "print_image";

export interface PrintedApparelInfo {
  isPrintedApparel: boolean;
  /** Print/design file URLs from custom.print_image (variant first). */
  printImageUrls: string[];
  /** Variant image, falling back to the product featured image. */
  mockupUrl: string | null;
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
  query printedApparelProduct($productId: ID!, $namespace: String!, $key: String!) {
    product(id: $productId) {
      productType
      featuredImage { url }
      metafield(namespace: $namespace, key: $key) { ${METAFIELD_FIELDS} }
    }
  }
`;

const PRODUCT_VARIANT_QUERY = `
  query printedApparelProductVariant($productId: ID!, $variantId: ID!, $namespace: String!, $key: String!) {
    product(id: $productId) {
      productType
      featuredImage { url }
      metafield(namespace: $namespace, key: $key) { ${METAFIELD_FIELDS} }
    }
    productVariant(id: $variantId) {
      image { url }
      metafield(namespace: $namespace, key: $key) { ${METAFIELD_FIELDS} }
    }
  }
`;

interface LookupQueryResult {
  product: {
    productType: string | null;
    featuredImage: { url: string | null } | null;
    metafield: MetafieldResult | null;
  } | null;
  productVariant?: {
    image: { url: string | null } | null;
    metafield: MetafieldResult | null;
  } | null;
}

// Short-lived per-process cache, same rationale as ready-print: syncs hit
// the same few products; merchants edit metafields and expect a refresh to
// pick changes up quickly.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { info: PrintedApparelInfo; at: number }>();

function isPrintedApparelType(productType: string | null | undefined): boolean {
  return (
    (productType ?? "").trim().replace(/\s+/g, " ").toLowerCase() ===
    PRINTED_APPAREL_PRODUCT_TYPE
  );
}

/**
 * Look up whether a product is Printed Apparel and, if so, its print image
 * (variant metafield first, product fallback) and mockup image. Never
 * throws: lookup failures return "not printed apparel" so a Shopify hiccup
 * degrades to the pre-existing classification.
 */
export async function getPrintedApparelInfo(
  productId: string,
  variantId: string | null
): Promise<PrintedApparelInfo> {
  const cacheKey = `${productId}:${variantId || ""}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  let info: PrintedApparelInfo = { isPrintedApparel: false, printImageUrls: [], mockupUrl: null };
  try {
    const variables: Record<string, string> = {
      productId: `gid://shopify/Product/${productId}`,
      namespace: METAFIELD_NAMESPACE,
      key: PRINT_IMAGE_KEY,
    };
    let query = PRODUCT_QUERY;
    if (variantId) {
      query = PRODUCT_VARIANT_QUERY;
      variables.variantId = `gid://shopify/ProductVariant/${variantId}`;
    }

    const data = await shopifyGraphql<LookupQueryResult>(query, variables);
    const product = data.product;
    if (product && isPrintedApparelType(product.productType)) {
      const variantUrls = metafieldUrls(data.productVariant?.metafield);
      const printImageUrls =
        variantUrls.length > 0 ? variantUrls : metafieldUrls(product.metafield);
      const mockupUrl =
        data.productVariant?.image?.url || product.featuredImage?.url || null;
      info = { isPrintedApparel: true, printImageUrls, mockupUrl };
    }
  } catch (e) {
    console.error(
      `Printed apparel lookup failed for product ${productId} variant ${variantId}:`,
      e
    );
    return info; // don't cache failures
  }

  cache.set(cacheKey, { info, at: Date.now() });
  return info;
}

/** For tests / manual refreshes. */
export function clearPrintedApparelCache(): void {
  cache.clear();
}

/**
 * Classification pass: mark Printed Apparel line items and attach the design
 * file + mockup. Mutates `items` in place. Runs after the ready-print pass,
 * so only still-unclassified ("other") items are candidates — product-ID
 * based types and ready-print items are left untouched.
 */
export async function applyPrintedApparelItems(
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
    if (item.itemType !== "other") continue;
    const ids = idsByLineItem.get(item.shopifyLineItemId);
    if (!ids) continue;

    const info = await getPrintedApparelInfo(ids.productId, ids.variantId);
    if (!info.isPrintedApparel) continue;

    item.itemType = "printed_apparel";
    item.designFileUrl = info.printImageUrls[0] ?? null;
    item.designFileUrls = info.printImageUrls.length > 1 ? info.printImageUrls : [];
    item.mockupUrl = info.mockupUrl;
  }
}
