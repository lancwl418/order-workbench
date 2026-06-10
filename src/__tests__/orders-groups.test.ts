import { describe, it, expect } from "vitest";
import { getFulfillmentGroups, groupLabelFromType } from "@/lib/orders/groups";

const it_ = (itemType: string, fo: string | null) => ({
  itemType,
  shopifyFulfillmentOrderId: fo,
});

describe("groupLabelFromType", () => {
  it("maps item types to human group labels", () => {
    expect(groupLabelFromType("free_sample")).toBe("Free Sample");
    expect(groupLabelFromType("transfer_by_size")).toBe("Transfer");
    expect(groupLabelFromType("gangsheet")).toBe("Transfer");
    expect(groupLabelFromType("other")).toBe("Blanks");
    expect(groupLabelFromType("anything_else")).toBe("Blanks");
  });
});

describe("getFulfillmentGroups", () => {
  it("returns [] when the order is not split (no fulfillment order ids)", () => {
    expect(
      getFulfillmentGroups([it_("other", null), it_("transfer_by_size", null)])
    ).toEqual([]);
  });

  it("returns [] when all items share one fulfillment order", () => {
    expect(
      getFulfillmentGroups([it_("other", "A"), it_("transfer_by_size", "A")])
    ).toEqual([]);
  });

  it("numbers groups and derives merged labels", () => {
    const groups = getFulfillmentGroups([
      it_("other", "A"),
      it_("transfer_by_size", "B"),
      it_("gangsheet", "B"),
      it_("free_sample", "C"),
    ]);
    expect(groups).toEqual([
      { foId: "A", num: 1, label: "Blanks" },
      { foId: "B", num: 2, label: "Transfer" },
      { foId: "C", num: 3, label: "Free Sample" },
    ]);
  });

  it("merges distinct labels within a single group", () => {
    const groups = getFulfillmentGroups([
      it_("other", "A"),
      it_("free_sample", "A"),
      it_("transfer_by_size", "B"),
    ]);
    expect(groups[0]).toEqual({ foId: "A", num: 1, label: "Blanks/Free Sample" });
  });

  it("ignores items with no fulfillment order id when others are split", () => {
    const groups = getFulfillmentGroups([
      it_("other", "A"),
      it_("transfer_by_size", "B"),
      it_("other", null),
    ]);
    expect(groups.map((g) => g.foId)).toEqual(["A", "B"]);
  });
});
