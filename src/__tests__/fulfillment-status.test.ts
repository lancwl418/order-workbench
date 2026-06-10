import { describe, it, expect } from "vitest";
import {
  computeSplitOrderStatus,
  fulfillmentGroups,
  type ItemLike,
  type ShipmentLike,
} from "@/lib/orders/fulfillment-status";

const item = (fo: string | null): ItemLike => ({ shopifyFulfillmentOrderId: fo });
const ship = (
  fo: string | null,
  status: string | null,
  tracking: string | null = null
): ShipmentLike => ({
  shopifyFulfillmentOrderId: fo,
  status,
  trackingNumber: tracking,
});

describe("fulfillmentGroups", () => {
  it("returns distinct non-null fulfillment order ids", () => {
    expect(
      fulfillmentGroups([item("A"), item("A"), item("B"), item(null)])
    ).toEqual(["A", "B"]);
  });
});

describe("computeSplitOrderStatus", () => {
  it("returns null when the order is not split (0 or 1 group)", () => {
    expect(computeSplitOrderStatus([item(null), item(null)], [])).toBeNull();
    expect(computeSplitOrderStatus([item("A"), item("A")], [])).toBeNull();
  });

  it("DELIVERED only when every group is delivered", () => {
    const items = [item("A"), item("B")];
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "delivered"),
        ship("B", "delivered"),
      ])
    ).toBe("DELIVERED");
    // one still in transit → not delivered
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "delivered"),
        ship("B", "in_transit"),
      ])
    ).toBe("SHIPPED");
  });

  it("SHIPPED only when every group has shipped", () => {
    const items = [item("A"), item("B")];
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "shipped"),
        ship("B", "in_transit"),
      ])
    ).toBe("SHIPPED");
    // one group only has a label → stays at LABEL_CREATED
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "shipped"),
        ship("B", "label_created", "1Z999"),
      ])
    ).toBe("LABEL_CREATED");
  });

  it("does not advance when a group has no shipment yet", () => {
    const items = [item("A"), item("B")];
    expect(
      computeSplitOrderStatus(items, [ship("A", "shipped")])
    ).toBeNull();
  });

  it("treats a tracking number as LABEL_CREATED", () => {
    const items = [item("A"), item("B")];
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "pending", "1Z111"),
        ship("B", null, "1Z222"),
      ])
    ).toBe("LABEL_CREATED");
  });

  it("surfaces DELAYED when any group failed", () => {
    const items = [item("A"), item("B")];
    expect(
      computeSplitOrderStatus(items, [
        ship("A", "delivered"),
        ship("B", "failure"),
      ])
    ).toBe("DELAYED");
  });
});
