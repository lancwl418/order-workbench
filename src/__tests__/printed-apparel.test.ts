import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGraphql = vi.fn();
vi.mock("@/lib/shopify/graphql", () => ({
  shopifyGraphql: (...args: unknown[]) => mockGraphql(...args),
}));

import {
  applyPrintedApparelItems,
  getPrintedApparelInfo,
  clearPrintedApparelCache,
} from "@/lib/shopify/printed-apparel";
import type { MappedOrderItem, ShopifyLineItem } from "@/lib/shopify/types";

function product(opts: {
  productType: string | null;
  metafield?: unknown;
  featuredImage?: string | null;
  variant?: { metafield?: unknown; image?: string | null };
}) {
  return {
    product: {
      productType: opts.productType,
      featuredImage: opts.featuredImage ? { url: opts.featuredImage } : null,
      metafield: opts.metafield ?? null,
    },
    ...(opts.variant !== undefined
      ? {
          productVariant: {
            image: opts.variant.image ? { url: opts.variant.image } : null,
            metafield: opts.variant.metafield ?? null,
          },
        }
      : {}),
  };
}

function urlMetafield(url: string) {
  return { type: "url", value: url, reference: null, references: null };
}

function item(over: Partial<MappedOrderItem>): MappedOrderItem {
  return {
    shopifyLineItemId: "1",
    title: "Item",
    variantTitle: null,
    sku: null,
    vendor: null,
    quantity: 1,
    price: "10.00",
    designFileUrl: null,
    designFileUrls: [],
    mockupUrl: null,
    itemType: "other",
    soldPerSheet: false,
    ...over,
  };
}

function lineItem(id: number, product_id: number, variant_id?: number): ShopifyLineItem {
  return { id, product_id, variant_id, title: "Item", quantity: 1, price: "10.00", fulfillable_quantity: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPrintedApparelCache();
});

describe("getPrintedApparelInfo", () => {
  it("matches the product type case/space-insensitively", async () => {
    mockGraphql.mockResolvedValue(
      product({
        productType: "  printed  APPAREL ",
        metafield: urlMetafield("https://x/design.png"),
        featuredImage: "https://x/featured.jpg",
      })
    );
    expect(await getPrintedApparelInfo("42", null)).toEqual({
      isPrintedApparel: true,
      printImageUrls: ["https://x/design.png"],
      mockupUrl: "https://x/featured.jpg",
    });
    expect(mockGraphql.mock.calls[0][1]).toMatchObject({
      productId: "gid://shopify/Product/42",
      namespace: "custom",
      key: "print_image",
    });
  });

  it("rejects other product types", async () => {
    mockGraphql.mockResolvedValue(
      product({ productType: "T-Shirt", metafield: urlMetafield("https://x/d.png") })
    );
    expect((await getPrintedApparelInfo("42", null)).isPrintedApparel).toBe(false);
  });

  it("prefers the variant metafield and variant image", async () => {
    mockGraphql.mockResolvedValue(
      product({
        productType: "Printed Apparel",
        metafield: urlMetafield("https://x/product-design.png"),
        featuredImage: "https://x/featured.jpg",
        variant: {
          metafield: urlMetafield("https://x/variant-design.png"),
          image: "https://x/variant.jpg",
        },
      })
    );
    expect(await getPrintedApparelInfo("42", "900")).toEqual({
      isPrintedApparel: true,
      printImageUrls: ["https://x/variant-design.png"],
      mockupUrl: "https://x/variant.jpg",
    });
    expect(mockGraphql.mock.calls[0][1]).toMatchObject({
      variantId: "gid://shopify/ProductVariant/900",
    });
  });

  it("falls back to product metafield + featured image when the variant has neither", async () => {
    mockGraphql.mockResolvedValue(
      product({
        productType: "Printed Apparel",
        metafield: urlMetafield("https://x/product-design.png"),
        featuredImage: "https://x/featured.jpg",
        variant: {},
      })
    );
    expect(await getPrintedApparelInfo("42", "901")).toEqual({
      isPrintedApparel: true,
      printImageUrls: ["https://x/product-design.png"],
      mockupUrl: "https://x/featured.jpg",
    });
  });

  it("degrades to not-printed-apparel on lookup failure", async () => {
    mockGraphql.mockRejectedValue(new Error("boom"));
    expect((await getPrintedApparelInfo("42", null)).isPrintedApparel).toBe(false);
  });
});

describe("applyPrintedApparelItems", () => {
  it("classifies only still-unclassified items and attaches design + mockup", async () => {
    mockGraphql.mockResolvedValue(
      product({
        productType: "Printed Apparel",
        metafield: urlMetafield("https://x/design.png"),
        featuredImage: "https://x/mock.jpg",
        variant: {},
      })
    );
    const items = [
      item({ shopifyLineItemId: "1", itemType: "other" }),
      item({ shopifyLineItemId: "2", itemType: "gangsheet", designFileUrl: "https://x/gs.png" }),
    ];
    await applyPrintedApparelItems(items, [lineItem(1, 42, 900), lineItem(2, 43)]);

    expect(items[0].itemType).toBe("printed_apparel");
    expect(items[0].designFileUrl).toBe("https://x/design.png");
    expect(items[0].mockupUrl).toBe("https://x/mock.jpg");
    // Already-classified items are left untouched (and not looked up)
    expect(items[1].itemType).toBe("gangsheet");
    expect(mockGraphql).toHaveBeenCalledTimes(1);
  });

  it("leaves non-apparel items as blanks", async () => {
    mockGraphql.mockResolvedValue(product({ productType: "Blank Tee", variant: {} }));
    const items = [item({ shopifyLineItemId: "1", itemType: "other" })];
    await applyPrintedApparelItems(items, [lineItem(1, 42, 900)]);
    expect(items[0].itemType).toBe("other");
    expect(items[0].mockupUrl).toBeNull();
  });
});
