import { describe, it, expect } from "vitest";
import {
  isExpressMethod,
  getGroupMethods,
  groupMethodFor,
} from "@/lib/orders/shipping";

describe("isExpressMethod", () => {
  it("detects express regardless of case", () => {
    expect(isExpressMethod("Express")).toBe(true);
    expect(isExpressMethod("Express Shipping")).toBe(true);
    expect(isExpressMethod("EXPRESS")).toBe(true);
  });

  it("detects an express component in an aggregated method", () => {
    expect(isExpressMethod("Standard + Express")).toBe(true);
  });

  it("detects expedited synonyms", () => {
    expect(isExpressMethod("Expedited")).toBe(true);
    expect(isExpressMethod("Overnight")).toBe(true);
    expect(isExpressMethod("Next Day Air")).toBe(true);
    expect(isExpressMethod("Rush")).toBe(true);
  });

  it("treats standard/pickup/unknown as non-express", () => {
    expect(isExpressMethod("Standard")).toBe(false);
    expect(isExpressMethod("Standard Shipping")).toBe(false);
    expect(isExpressMethod("pickup")).toBe(false);
    expect(isExpressMethod("Economy")).toBe(false);
  });

  it("treats null/undefined/empty as non-express", () => {
    expect(isExpressMethod(null)).toBe(false);
    expect(isExpressMethod(undefined)).toBe(false);
    expect(isExpressMethod("")).toBe(false);
  });
});

describe("getGroupMethods", () => {
  it("narrows a valid foId -> method map", () => {
    expect(getGroupMethods({ "123": "Express", "456": "Standard" })).toEqual({
      "123": "Express",
      "456": "Standard",
    });
  });

  it("drops non-string values", () => {
    expect(getGroupMethods({ "123": "Express", "456": 5 })).toEqual({
      "123": "Express",
    });
  });

  it("returns null for null, arrays, scalars, and empty objects", () => {
    expect(getGroupMethods(null)).toBeNull();
    expect(getGroupMethods(undefined)).toBeNull();
    expect(getGroupMethods(["Express"])).toBeNull();
    expect(getGroupMethods("Express")).toBeNull();
    expect(getGroupMethods({})).toBeNull();
    expect(getGroupMethods({ "123": "" })).toBeNull();
  });
});

describe("groupMethodFor", () => {
  const methods = { "123": "Express" };

  it("returns the group's own method when present", () => {
    expect(groupMethodFor(methods, "123", "Standard + Express")).toBe("Express");
  });

  it("falls back to the order-level method for unknown groups", () => {
    expect(groupMethodFor(methods, "999", "Standard")).toBe("Standard");
    expect(groupMethodFor(null, "123", "Standard")).toBe("Standard");
  });

  it("returns null when nothing is known", () => {
    expect(groupMethodFor(null, "123", null)).toBeNull();
    expect(groupMethodFor(null, "123", undefined)).toBeNull();
  });
});
