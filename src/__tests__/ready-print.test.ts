import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGraphql = vi.fn();
vi.mock("@/lib/shopify/graphql", () => ({
  shopifyGraphql: (...args: unknown[]) => mockGraphql(...args),
}));

import {
  applyReadyPrintItems,
  getReadyPrintProductInfo,
  clearReadyPrintCache,
} from "@/lib/shopify/ready-print";
import { transformShopifyOrderWithProducts } from "@/lib/shopify/orders";
import type { MappedOrderItem, ShopifyLineItem, ShopifyOrder } from "@/lib/shopify/types";

function product(tags: string[], metafield: unknown) {
  return { product: { tags, metafield } };
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
    itemType: "other",
    ...over,
  };
}

function lineItem(id: number, product_id: number, title = "Item"): ShopifyLineItem {
  return { id, product_id, title, quantity: 1, price: "10.00", fulfillable_quantity: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearReadyPrintCache();
});

describe("getReadyPrintProductInfo", () => {
  it("reads a file_reference metafield url when tagged readyprint", async () => {
    mockGraphql.mockResolvedValue(
      product(["Transfers", "ReadyPrint"], {
        type: "file_reference",
        value: "gid://shopify/GenericFile/1",
        reference: { url: "https://cdn.shopify.com/files/sheet.png" },
      })
    );
    expect(await getReadyPrintProductInfo("42")).toEqual({
      isReadyPrint: true,
      transferFileUrl: "https://cdn.shopify.com/files/sheet.png",
    });
    expect(mockGraphql.mock.calls[0][1]).toMatchObject({
      id: "gid://shopify/Product/42",
      namespace: "custom",
      key: "transfer_file",
    });
  });

  it("falls back to a MediaImage reference or plain url value", async () => {
    mockGraphql.mockResolvedValueOnce(
      product(["readyprint"], {
        type: "file_reference",
        value: "gid://shopify/MediaImage/1",
        reference: { image: { url: "https://cdn.shopify.com/img.png" } },
      })
    );
    expect((await getReadyPrintProductInfo("1")).transferFileUrl).toBe(
      "https://cdn.shopify.com/img.png"
    );

    mockGraphql.mockResolvedValueOnce(
      product(["readyprint"], { type: "url", value: " https://files.example.com/a.png ", reference: null })
    );
    expect((await getReadyPrintProductInfo("2")).transferFileUrl).toBe(
      "https://files.example.com/a.png"
    );
  });

  it("is not ready print without the tag", async () => {
    mockGraphql.mockResolvedValue(
      product(["Transfers"], { type: "url", value: "https://x/a.png", reference: null })
    );
    expect(await getReadyPrintProductInfo("3")).toEqual({
      isReadyPrint: false,
      transferFileUrl: null,
    });
  });

  it("caches per product and swallows lookup errors", async () => {
    mockGraphql.mockResolvedValue(product(["readyprint"], null));
    await getReadyPrintProductInfo("5");
    await getReadyPrintProductInfo("5");
    expect(mockGraphql).toHaveBeenCalledTimes(1);

    mockGraphql.mockRejectedValue(new Error("down"));
    expect(await getReadyPrintProductInfo("6")).toEqual({
      isReadyPrint: false,
      transferFileUrl: null,
    });
  });
});

describe("applyReadyPrintItems", () => {
  it("marks tagged products as ready_print with the metafield link", async () => {
    mockGraphql.mockResolvedValue(
      product(["readyprint"], { type: "url", value: "https://x/sheet.png", reference: null })
    );
    const items = [item({ shopifyLineItemId: "10", quantity: 3 })];
    await applyReadyPrintItems(items, [lineItem(10, 500)]);
    expect(items[0].itemType).toBe("ready_print");
    expect(items[0].designFileUrl).toBe("https://x/sheet.png");
    expect(items[0].quantity).toBe(3);
  });

  it("also checks title-fallback gangsheet items that have no print file", async () => {
    mockGraphql.mockResolvedValue(
      product(["readyprint"], { type: "url", value: "https://x/sheet.png", reference: null })
    );
    const items = [item({ shopifyLineItemId: "10", itemType: "gangsheet", title: "Russell Sprinkle Gang Sheet" })];
    await applyReadyPrintItems(items, [lineItem(10, 500)]);
    expect(items[0].itemType).toBe("ready_print");
  });

  it("leaves recognized Drip transfers, free samples and untagged blanks alone", async () => {
    mockGraphql.mockResolvedValue(product(["Blanks"], null));
    const items = [
      item({ shopifyLineItemId: "1", itemType: "transfer_by_size", designFileUrl: "https://drip/page" }),
      item({ shopifyLineItemId: "2", itemType: "gangsheet", designFileUrl: "https://drip/uploads/a.png" }),
      item({ shopifyLineItemId: "3", itemType: "free_sample" }),
      item({ shopifyLineItemId: "4", itemType: "other" }),
    ];
    await applyReadyPrintItems(items, [lineItem(1, 1), lineItem(2, 2), lineItem(3, 3), lineItem(4, 4)]);
    expect(items.map((i) => i.itemType)).toEqual(["transfer_by_size", "gangsheet", "free_sample", "other"]);
    expect(mockGraphql).toHaveBeenCalledTimes(1); // only the blank was looked up
  });
});

describe("transformShopifyOrderWithProducts", () => {
  it("keeps normal transfers and adds ready print items in one order", async () => {
    mockGraphql.mockImplementation(async (_q: string, vars: { id: string }) =>
      vars.id.endsWith("/777")
        ? product(["readyprint"], { type: "url", value: "https://x/ready.png", reference: null })
        : product([], null)
    );
    const order = {
      id: 1, order_number: 1, name: "#4486", created_at: "2024-06-01T00:00:00Z",
      updated_at: "2024-06-01T00:00:00Z", financial_status: "paid", fulfillment_status: null,
      total_price: "1", subtotal_price: "1", total_tax: "0", currency: "USD",
      line_items: [
        {
          id: 1, product_id: 9000096399595, title: "Transfer by Size", quantity: 2, price: "1",
          fulfillable_quantity: 2, properties: [{ name: "_Print Ready", value: "https://drip/page" }],
        },
        { id: 2, product_id: 777, title: "Russell Sprinkle Gang Sheet", quantity: 3, price: "1", fulfillable_quantity: 3 },
        { id: 3, product_id: 888, title: "Gildan Tee", quantity: 1, price: "1", fulfillable_quantity: 1 },
      ],
    } as unknown as ShopifyOrder;

    const { items } = await transformShopifyOrderWithProducts(order);
    expect(items.map((i) => [i.itemType, i.designFileUrl])).toEqual([
      ["transfer_by_size", "https://drip/page"],
      ["ready_print", "https://x/ready.png"],
      ["other", null],
    ]);
  });
});
