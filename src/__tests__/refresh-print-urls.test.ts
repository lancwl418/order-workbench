import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
    orderItem: { update: (...args: unknown[]) => mockUpdate(...args) },
  },
}));

// Mock Shopify functions
const mockFetchOrderById = vi.fn();
vi.mock("@/lib/shopify/orders", () => ({
  fetchOrderById: (...args: unknown[]) => mockFetchOrderById(...args),
  transformShopifyOrder: (shopifyOrder: { _freshItems: { shopifyLineItemId: string; designFileUrl: string | null }[] }) => ({
    order: {},
    items: shopifyOrder._freshItems || [],
    fulfillments: [],
  }),
}));

import { refreshPrintFileUrls } from "@/lib/shopify/refresh-print-urls";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("refreshPrintFileUrls", () => {
  it("returns 0 when order not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await refreshPrintFileUrls("nonexistent")).toBe(0);
  });

  it("returns 0 when order has no shopifyOrderId", async () => {
    mockFindUnique.mockResolvedValue({ shopifyOrderId: null, orderItems: [] });
    expect(await refreshPrintFileUrls("order1")).toBe(0);
  });

  it("returns 0 when Shopify fetch fails", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: "li1", designFileUrl: "https://old.com/a.png", originalDesignFileUrl: null },
      ],
    });
    mockFetchOrderById.mockRejectedValue(new Error("API down"));

    expect(await refreshPrintFileUrls("order1")).toBe(0);
  });

  it("updates designFileUrl when Shopify has a newer URL", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: "li1", designFileUrl: "https://old.com/a.png", originalDesignFileUrl: null },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: "https://new.com/b.png" },
      ],
    });
    mockUpdate.mockResolvedValue({});

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { designFileUrl: "https://new.com/b.png" },
    });
  });

  it("does NOT update when URL is the same", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: "li1", designFileUrl: "https://same.com/a.png", originalDesignFileUrl: null },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: "https://same.com/a.png" },
      ],
    });

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips items that were manually replaced (originalDesignFileUrl set)", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        {
          id: "item1",
          shopifyLineItemId: "li1",
          designFileUrl: "https://replaced.com/custom.png",
          originalDesignFileUrl: "https://old.com/a.png",
        },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: "https://new.com/b.png" },
      ],
    });

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips items without shopifyLineItemId", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: null, designFileUrl: "https://old.com/a.png", originalDesignFileUrl: null },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: "https://new.com/b.png" },
      ],
    });

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("handles multiple items, only updates changed ones", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: "li1", designFileUrl: "https://old.com/a.png", originalDesignFileUrl: null },
        { id: "item2", shopifyLineItemId: "li2", designFileUrl: "https://same.com/b.png", originalDesignFileUrl: null },
        { id: "item3", shopifyLineItemId: "li3", designFileUrl: "https://replaced.com/c.png", originalDesignFileUrl: "https://orig.com/c.png" },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: "https://updated.com/a2.png" },
        { shopifyLineItemId: "li2", designFileUrl: "https://same.com/b.png" },
        { shopifyLineItemId: "li3", designFileUrl: "https://new.com/c2.png" },
      ],
    });
    mockUpdate.mockResolvedValue({});

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(1); // only item1 updated
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { designFileUrl: "https://updated.com/a2.png" },
    });
  });

  it("does NOT update when Shopify returns null URL", async () => {
    mockFindUnique.mockResolvedValue({
      shopifyOrderId: "12345",
      orderItems: [
        { id: "item1", shopifyLineItemId: "li1", designFileUrl: "https://old.com/a.png", originalDesignFileUrl: null },
      ],
    });
    mockFetchOrderById.mockResolvedValue({
      _freshItems: [
        { shopifyLineItemId: "li1", designFileUrl: null },
      ],
    });

    const count = await refreshPrintFileUrls("order1");

    expect(count).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
