import { createShopifyRestClient } from "./client";

interface ShopifyProductImage {
  id: number;
  src: string;
  variant_ids?: number[];
}

interface ShopifyProductResponse {
  product?: {
    image?: { src?: string } | null;
    images?: ShopifyProductImage[];
    variants?: { id: number; image_id?: number | null }[];
  };
}

// Per-process cache — pushes repeatedly hit the same few blank products.
const cache = new Map<string, string | null>();

/**
 * Resolve the image URL for a product variant: the variant's own image if it
 * has one, else the product's main image. Returns null when the product has
 * no images or the lookup fails (callers fall back to a placeholder).
 */
export async function getVariantImageUrl(
  productId: string,
  variantId: string | null
): Promise<string | null> {
  const cacheKey = `${productId}:${variantId ?? ""}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let url: string | null = null;
  try {
    const client = createShopifyRestClient();
    const res = await client.get({ path: `products/${productId}` });
    const product = (res.body as ShopifyProductResponse).product;
    if (product) {
      if (variantId) {
        const variant = product.variants?.find((v) => String(v.id) === variantId);
        if (variant?.image_id) {
          url = product.images?.find((i) => i.id === variant.image_id)?.src ?? null;
        }
        if (!url) {
          url = product.images?.find((i) => i.variant_ids?.some((v) => String(v) === variantId))?.src ?? null;
        }
      }
      url = url ?? product.image?.src ?? product.images?.[0]?.src ?? null;
    }
  } catch {
    url = null;
  }

  cache.set(cacheKey, url);
  return url;
}
