import { describe, it, expect } from "vitest";
import type { Order, OrderItem } from "@prisma/client";
import { mapOrderToEccangParams, type PackageInfo } from "@/lib/eccangtms/mapper";

const pkg: PackageInfo = { weightLbs: 1, lengthIn: 10, widthIn: 8, heightIn: 2 };

function makeOrder(overrides: Partial<Order> = {}): Order & { orderItems: OrderItem[] } {
  return {
    id: "order_abcdef12",
    shopifyOrderNumber: "#5566",
    customerName: "Jane Doe",
    customerPhone: "5551234567",
    customerEmail: "jane@example.com",
    totalPrice: "42.00",
    currency: "USD",
    shippingAddress: {
      first_name: "Jane",
      last_name: "Doe",
      address1: "1 Main St",
      city: "LA",
      province_code: "CA",
      zip: "90001",
      country_code: "US",
      phone: "5551234567",
    },
    ...overrides,
    orderItems: [
      { price: "21.00", quantity: 2, sku: "SKU1" } as unknown as OrderItem,
    ],
  } as unknown as Order & { orderItems: OrderItem[] };
}

describe("mapOrderToEccangParams customerNo", () => {
  it("uses the bare order number when no sequence is given", () => {
    const params = mapOrderToEccangParams(makeOrder(), "PROD", pkg);
    expect(params.customerNo).toBe("5566");
  });

  it("appends the sequence suffix to customerNo (split push)", () => {
    expect(mapOrderToEccangParams(makeOrder(), "PROD", pkg, 1).customerNo).toBe("5566-1");
    expect(mapOrderToEccangParams(makeOrder(), "PROD", pkg, 3).customerNo).toBe("5566-3");
  });

  it("only changes customerNo — consigneeName keeps the base order number", () => {
    const params = mapOrderToEccangParams(makeOrder(), "PROD", pkg, 2);
    expect(params.customerNo).toBe("5566-2");
    expect(params.consigneeShipper.consigneeName).toBe("Jane Doe-5566");
  });

  it("falls back to a slice of the id when there is no shopify order number", () => {
    const params = mapOrderToEccangParams(
      makeOrder({ shopifyOrderNumber: null }),
      "PROD",
      pkg,
      1
    );
    expect(params.customerNo).toBe("order_ab-1");
  });
});
