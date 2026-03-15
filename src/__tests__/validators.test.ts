import { describe, it, expect } from "vitest";
import {
  orderQuerySchema,
  orderUpdateSchema,
  bulkUpdateSchema,
  shipmentCreateSchema,
  exceptionQuerySchema,
} from "@/lib/validators";

describe("orderQuerySchema", () => {
  it("applies defaults for empty input", () => {
    const result = orderQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
    expect(result.sort).toBe("createdAt");
    expect(result.dir).toBe("desc");
    expect(result.view).toBe("all");
  });

  it("coerces string numbers to numbers", () => {
    const result = orderQuerySchema.parse({ page: "3", limit: "50" });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it("rejects page < 1", () => {
    expect(() => orderQuerySchema.parse({ page: 0 })).toThrow();
  });

  it("rejects limit > 100", () => {
    expect(() => orderQuerySchema.parse({ limit: 200 })).toThrow();
  });

  it("accepts valid status values", () => {
    const result = orderQuerySchema.parse({ status: "OPEN" });
    expect(result.status).toBe("OPEN");
  });

  it("rejects invalid status values", () => {
    expect(() => orderQuerySchema.parse({ status: "INVALID" })).toThrow();
  });

  it("accepts valid printStatus", () => {
    const result = orderQuerySchema.parse({ printStatus: "DONE" });
    expect(result.printStatus).toBe("DONE");
  });

  it("accepts valid view values", () => {
    for (const view of ["all", "print-queue", "cs-queue", "exceptions"]) {
      const result = orderQuerySchema.parse({ view });
      expect(result.view).toBe(view);
    }
  });

  it("accepts search string", () => {
    const result = orderQuerySchema.parse({ search: "#1001" });
    expect(result.search).toBe("#1001");
  });

  it("accepts sort direction", () => {
    const result = orderQuerySchema.parse({ dir: "asc" });
    expect(result.dir).toBe("asc");
  });
});

describe("orderUpdateSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = orderUpdateSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts valid internalStatus", () => {
    const result = orderUpdateSchema.parse({ internalStatus: "SHIPPED" });
    expect(result.internalStatus).toBe("SHIPPED");
  });

  it("accepts priority in valid range", () => {
    const result = orderUpdateSchema.parse({ priority: 3 });
    expect(result.priority).toBe(3);
  });

  it("rejects priority > 5", () => {
    expect(() => orderUpdateSchema.parse({ priority: 6 })).toThrow();
  });

  it("rejects priority < 0", () => {
    expect(() => orderUpdateSchema.parse({ priority: -1 })).toThrow();
  });

  it("accepts nullable csNote", () => {
    const result = orderUpdateSchema.parse({ csNote: null });
    expect(result.csNote).toBeNull();
  });

  it("accepts csFlag boolean", () => {
    const result = orderUpdateSchema.parse({ csFlag: true });
    expect(result.csFlag).toBe(true);
  });

  it("accepts tags array", () => {
    const result = orderUpdateSchema.parse({ tags: ["urgent", "vip"] });
    expect(result.tags).toEqual(["urgent", "vip"]);
  });
});

describe("bulkUpdateSchema", () => {
  it("requires at least one orderId", () => {
    expect(() => bulkUpdateSchema.parse({ orderIds: [] })).toThrow();
  });

  it("accepts valid bulk update", () => {
    const result = bulkUpdateSchema.parse({
      orderIds: ["id1", "id2"],
      internalStatus: "SHIPPED",
    });
    expect(result.orderIds).toHaveLength(2);
    expect(result.internalStatus).toBe("SHIPPED");
  });
});

describe("shipmentCreateSchema", () => {
  it("requires orderId", () => {
    expect(() => shipmentCreateSchema.parse({})).toThrow();
  });

  it("defaults sourceType to MANUAL", () => {
    const result = shipmentCreateSchema.parse({ orderId: "order-1" });
    expect(result.sourceType).toBe("MANUAL");
  });

  it("accepts all valid source types", () => {
    for (const sourceType of ["SHOPIFY", "THIRD_PARTY", "MANUAL"]) {
      const result = shipmentCreateSchema.parse({ orderId: "o1", sourceType });
      expect(result.sourceType).toBe(sourceType);
    }
  });
});

describe("exceptionQuerySchema", () => {
  it("applies defaults", () => {
    const result = exceptionQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(25);
  });

  it("accepts valid exception types", () => {
    const result = exceptionQuerySchema.parse({ type: "LONG_TRANSIT" });
    expect(result.type).toBe("LONG_TRANSIT");
  });

  it("accepts severity filter", () => {
    const result = exceptionQuerySchema.parse({ severity: "HIGH" });
    expect(result.severity).toBe("HIGH");
  });

  it("accepts category filter", () => {
    const result = exceptionQuerySchema.parse({ category: "shipment" });
    expect(result.category).toBe("shipment");
  });
});
