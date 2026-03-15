import { describe, it, expect } from "vitest";
import { getNextStatus, getPrevStatus } from "@/lib/constants";

describe("getNextStatus", () => {
  it("OPEN -> REVIEW", () => {
    expect(getNextStatus("OPEN")).toBe("REVIEW");
  });

  it("REVIEW -> LABEL_CREATED", () => {
    expect(getNextStatus("REVIEW")).toBe("LABEL_CREATED");
  });

  it("LABEL_CREATED -> SHIPPED", () => {
    expect(getNextStatus("LABEL_CREATED")).toBe("SHIPPED");
  });

  it("SHIPPED -> DELIVERED", () => {
    expect(getNextStatus("SHIPPED")).toBe("DELIVERED");
  });

  it("DELIVERED has no next (end of flow)", () => {
    expect(getNextStatus("DELIVERED")).toBeNull();
  });

  it("returns null for statuses not in the flow (DELAYED)", () => {
    expect(getNextStatus("DELAYED")).toBeNull();
  });

  it("returns null for CANCELLED", () => {
    expect(getNextStatus("CANCELLED")).toBeNull();
  });

  it("returns null for unknown status", () => {
    expect(getNextStatus("NONEXISTENT")).toBeNull();
  });
});

describe("getPrevStatus", () => {
  it("OPEN has no previous (start of flow)", () => {
    expect(getPrevStatus("OPEN")).toBeNull();
  });

  it("REVIEW -> OPEN", () => {
    expect(getPrevStatus("REVIEW")).toBe("OPEN");
  });

  it("LABEL_CREATED -> REVIEW", () => {
    expect(getPrevStatus("LABEL_CREATED")).toBe("REVIEW");
  });

  it("SHIPPED -> LABEL_CREATED", () => {
    expect(getPrevStatus("SHIPPED")).toBe("LABEL_CREATED");
  });

  it("DELIVERED -> SHIPPED", () => {
    expect(getPrevStatus("DELIVERED")).toBe("SHIPPED");
  });

  it("returns null for statuses not in the flow", () => {
    expect(getPrevStatus("DELAYED")).toBeNull();
    expect(getPrevStatus("CANCELLED")).toBeNull();
  });
});
