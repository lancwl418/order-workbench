import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    shipment: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

import { upsertShipmentFromShopifyFulfillment } from "@/lib/shipments/from-shopify-fulfillment";

const base = {
  orderId: "o1",
  shopifyFulfillmentId: "f1",
  trackingNumber: "9214490401713216541234",
  trackingUrl: "https://usps/9214490401713216541234",
  carrier: "USPS",
  status: "in_transit",
  shippedAt: new Date("2026-09-01T00:00:00Z"),
  shopifyFulfillmentOrderId: "fo1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockImplementation(async (args) => ({ id: args.where.id, ...args.data }));
  mockCreate.mockImplementation(async (args) => ({ id: "new", ...args.data }));
});

describe("upsertShipmentFromShopifyFulfillment", () => {
  it("updates the shipment already linked to this fulfillment id", async () => {
    mockFindUnique.mockResolvedValue({ id: "s1", shopifyFulfillmentId: "f1" });

    await upsertShipmentFromShopifyFulfillment(base);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: expect.objectContaining({ status: "in_transit", shopifyFulfillmentOrderId: "fo1" }),
      })
    );
  });

  it("adopts an unlinked OMS shipment with the same tracking instead of creating a duplicate", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      {
        id: "oms",
        trackingNumber: "9214490401713216541234",
        carrier: "东易美运-美西USPS-2",
        trackingUrl: null,
        shippedAt: null,
        shopifyFulfillmentOrderId: null,
        shopifyFulfillmentId: null,
      },
    ]);

    await upsertShipmentFromShopifyFulfillment(base);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderId: "o1", shopifyFulfillmentId: null }) })
    );
    const data = mockUpdate.mock.calls[0][0].data;
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "oms" });
    expect(data.shopifyFulfillmentId).toBe("f1");
    expect(data.syncStatus).toBe("SYNCED");
    expect(data.labelStatus).toBe("SYNCED_TO_SHOPIFY");
    // OMS carrier is kept; blanks are filled from Shopify
    expect(data.carrier).toBeUndefined();
    expect(data.trackingUrl).toBe(base.trackingUrl);
    expect(data.shippedAt).toEqual(base.shippedAt);
    expect(data.shopifyFulfillmentOrderId).toBe("fo1");
  });

  it("adopts on containment match (factory appends order number)", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      { id: "factory", trackingNumber: "92144904017132165412344436", carrier: "USPS", trackingUrl: "u", shippedAt: new Date(), shopifyFulfillmentOrderId: "fo1" },
    ]);

    await upsertShipmentFromShopifyFulfillment(base);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "factory" });
  });

  it("creates a SHOPIFY shipment when nothing matches", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([
      { id: "other", trackingNumber: "1Z999AA10123456784", carrier: "UPS" },
    ]);

    await upsertShipmentFromShopifyFulfillment({ ...base, deliveredAt: new Date("2026-09-03T00:00:00Z") });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: "o1",
        sourceType: "SHOPIFY",
        shopifyFulfillmentId: "f1",
        syncStatus: "SYNCED",
        trackingNumber: base.trackingNumber,
        deliveredAt: new Date("2026-09-03T00:00:00Z"),
      }),
    });
  });

  it("does not try to adopt when the fulfillment has no tracking", async () => {
    mockFindUnique.mockResolvedValue(null);

    await upsertShipmentFromShopifyFulfillment({ ...base, trackingNumber: null });

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });
});
