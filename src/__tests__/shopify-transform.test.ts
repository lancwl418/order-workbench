import { describe, it, expect } from "vitest";
import { transformShopifyOrder } from "@/lib/shopify/orders";
import type { ShopifyOrder } from "@/lib/shopify/types";

function makeShopifyOrder(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: 1001,
    order_number: 1001,
    name: "#1001",
    email: "test@example.com",
    created_at: "2024-06-01T10:00:00Z",
    updated_at: "2024-06-01T12:00:00Z",
    financial_status: "paid",
    fulfillment_status: null,
    total_price: "49.99",
    subtotal_price: "39.99",
    total_tax: "5.00",
    currency: "USD",
    customer: {
      id: 100,
      email: "test@example.com",
      first_name: "John",
      last_name: "Doe",
    },
    shipping_address: {
      name: "John Doe",
      address1: "123 Main St",
      city: "Austin",
      province: "TX",
      country: "US",
      zip: "78701",
    },
    line_items: [
      {
        id: 2001,
        title: "Custom DTF Print",
        quantity: 2,
        price: "19.99",
        fulfillable_quantity: 2,
        properties: [],
      },
    ],
    shipping_lines: [{ title: "Standard Shipping", price: "5.00" }],
    tags: "vip, rush",
    note: "Please handle with care",
    ...overrides,
  };
}

describe("transformShopifyOrder", () => {
  it("maps basic order fields correctly", () => {
    const shopifyOrder = makeShopifyOrder();
    const { order } = transformShopifyOrder(shopifyOrder);

    expect(order.shopifyOrderId).toBe("1001");
    expect(order.shopifyOrderNumber).toBe("#1001");
    expect(order.shopifyStatus).toBe("paid");
    expect(order.totalPrice).toBe("49.99");
    expect(order.currency).toBe("USD");
    expect(order.notes).toBe("Please handle with care");
  });

  it("extracts customer name from customer object", () => {
    const { order } = transformShopifyOrder(makeShopifyOrder());
    expect(order.customerName).toBe("John Doe");
  });

  it("falls back to shipping address name if no customer name", () => {
    const { order } = transformShopifyOrder(
      makeShopifyOrder({
        customer: { id: 1 },
        shipping_address: { name: "Jane Smith" },
      })
    );
    expect(order.customerName).toBe("Jane Smith");
  });

  it("sets customerName null when no name available", () => {
    const { order } = transformShopifyOrder(
      makeShopifyOrder({
        customer: { id: 1 },
        shipping_address: undefined,
      })
    );
    expect(order.customerName).toBeNull();
  });

  it("extracts customer email and phone", () => {
    const { order } = transformShopifyOrder(
      makeShopifyOrder({
        email: "order@test.com",
        phone: "+1234567890",
      })
    );
    expect(order.customerEmail).toBe("order@test.com");
    expect(order.customerPhone).toBe("+1234567890");
  });

  it("extracts shipping method from first shipping line", () => {
    const { order } = transformShopifyOrder(makeShopifyOrder());
    expect(order.shippingMethod).toBe("Standard Shipping");
  });

  it("sets shippingMethod null when no shipping lines", () => {
    const { order } = transformShopifyOrder(
      makeShopifyOrder({ shipping_lines: [] })
    );
    expect(order.shippingMethod).toBeNull();
  });

  it("parses tags into array", () => {
    const { order } = transformShopifyOrder(makeShopifyOrder({ tags: "vip, rush, priority" }));
    expect(order.tags).toEqual(["vip", "rush", "priority"]);
  });

  it("handles empty tags", () => {
    const { order } = transformShopifyOrder(makeShopifyOrder({ tags: "" }));
    expect(order.tags).toEqual([]);
  });

  it("maps line items correctly", () => {
    const { items } = transformShopifyOrder(makeShopifyOrder());
    expect(items).toHaveLength(1);
    expect(items[0].shopifyLineItemId).toBe("2001");
    expect(items[0].title).toBe("Custom DTF Print");
    expect(items[0].quantity).toBe(2);
    expect(items[0].price).toBe("19.99");
  });

  describe("internal status mapping", () => {
    it("unfulfilled paid -> OPEN", () => {
      const { order } = transformShopifyOrder(
        makeShopifyOrder({ fulfillment_status: null, financial_status: "paid" })
      );
      expect(order.internalStatus).toBe("OPEN");
    });

    it("fulfilled -> LABEL_CREATED", () => {
      const { order } = transformShopifyOrder(
        makeShopifyOrder({ fulfillment_status: "fulfilled" })
      );
      expect(order.internalStatus).toBe("LABEL_CREATED");
    });

    it("cancelled_at set -> CANCELLED", () => {
      const { order } = transformShopifyOrder(
        makeShopifyOrder({ cancelled_at: "2024-06-02T00:00:00Z" })
      );
      expect(order.internalStatus).toBe("CANCELLED");
    });

    it("refunded -> CANCELLED", () => {
      const { order } = transformShopifyOrder(
        makeShopifyOrder({ financial_status: "refunded" })
      );
      expect(order.internalStatus).toBe("CANCELLED");
    });

    it("voided -> CANCELLED", () => {
      const { order } = transformShopifyOrder(
        makeShopifyOrder({ financial_status: "voided" })
      );
      expect(order.internalStatus).toBe("CANCELLED");
    });
  });

  describe("fulfillment extraction", () => {
    it("extracts fulfillments with tracking", () => {
      const { fulfillments } = transformShopifyOrder(
        makeShopifyOrder({
          fulfillments: [
            {
              id: 3001,
              order_id: 1001,
              status: "success",
              tracking_number: "1Z999",
              tracking_company: "UPS",
              tracking_url: "https://ups.com/track/1Z999",
              line_items: [],
              created_at: "2024-06-02T00:00:00Z",
              updated_at: "2024-06-02T00:00:00Z",
            },
          ],
        })
      );

      expect(fulfillments).toHaveLength(1);
      expect(fulfillments[0].trackingNumber).toBe("1Z999");
      expect(fulfillments[0].carrier).toBe("UPS");
    });

    it("skips fulfillments without tracking", () => {
      const { fulfillments } = transformShopifyOrder(
        makeShopifyOrder({
          fulfillments: [
            {
              id: 3001,
              order_id: 1001,
              status: "success",
              line_items: [],
              created_at: "2024-06-02T00:00:00Z",
              updated_at: "2024-06-02T00:00:00Z",
            },
          ],
        })
      );

      expect(fulfillments).toHaveLength(0);
    });
  });

  describe("design file URL extraction", () => {
    it("extracts _Print Ready File for Build a Gangsheet product", () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            {
              id: 5001,
              title: "Gang Sheet",
              quantity: 1,
              price: "29.99",
              product_id: 8999852835051,
              fulfillable_quantity: 1,
              properties: [
                { name: "_Print Ready File", value: "https://example.com/uploads/gang.png" },
              ],
            },
          ],
        })
      );

      expect(items[0].designFileUrl).toBe("https://example.com/uploads/gang.png");
    });

    it("extracts _Print Ready for Transfer by Size product", () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            {
              id: 5002,
              title: "Transfer Sheet",
              quantity: 1,
              price: "19.99",
              product_id: 9000096399595,
              fulfillable_quantity: 1,
              properties: [
                { name: "_Print Ready", value: "https://transferbysize.com/order/123" },
              ],
            },
          ],
        })
      );

      expect(items[0].designFileUrl).toBe("https://transferbysize.com/order/123");
    });

    it("shares one _Print Ready URL across multiple Transfer by Size items", () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            {
              id: 5003,
              title: "Transfer A",
              quantity: 1,
              price: "10.00",
              product_id: 9000096399595,
              fulfillable_quantity: 1,
              properties: [
                { name: "_Print Ready", value: "https://transferbysize.com/order/abc" },
              ],
            },
            {
              id: 5004,
              title: "Transfer B",
              quantity: 1,
              price: "10.00",
              product_id: 9000096399595,
              fulfillable_quantity: 1,
              properties: [],
            },
          ],
        })
      );

      // Both items share the same URL
      expect(items[0].designFileUrl).toBe("https://transferbysize.com/order/abc");
      expect(items[1].designFileUrl).toBe("https://transferbysize.com/order/abc");
    });
  });

  describe("item type fallback by title", () => {
    it('classifies "other" item as gangsheet when title contains "transfer"', () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            { id: 6001, title: "DTF Transfer 22x30", quantity: 1, price: "15.00", fulfillable_quantity: 1 },
          ],
        })
      );
      expect(items[0].itemType).toBe("gangsheet");
    });

    it('classifies "other" item as gangsheet when title contains "gang sheet"', () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            { id: 6002, title: "Custom Gang Sheet Print", quantity: 1, price: "25.00", fulfillable_quantity: 1 },
          ],
        })
      );
      expect(items[0].itemType).toBe("gangsheet");
    });

    it('classifies "other" item as gangsheet when title contains "gangsheet"', () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            { id: 6003, title: "Gangsheet Bundle", quantity: 1, price: "30.00", fulfillable_quantity: 1 },
          ],
        })
      );
      expect(items[0].itemType).toBe("gangsheet");
    });

    it("is case insensitive", () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            { id: 6004, title: "CUSTOM TRANSFER PACK", quantity: 1, price: "20.00", fulfillable_quantity: 1 },
          ],
        })
      );
      expect(items[0].itemType).toBe("gangsheet");
    });

    it('keeps "other" when title has no transfer keywords', () => {
      const { items } = transformShopifyOrder(
        makeShopifyOrder({
          line_items: [
            { id: 6005, title: "Blank T-Shirt White", quantity: 1, price: "10.00", fulfillable_quantity: 1 },
          ],
        })
      );
      expect(items[0].itemType).toBe("other");
    });
  });
});
