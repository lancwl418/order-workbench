import { describe, it, expect } from "vitest";
import { getNextStatus, getPrevStatus, shouldAutoClearCsFlag } from "@/lib/constants";

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

describe("shouldAutoClearCsFlag", () => {
  it("clears csFlag when moving to LABEL_CREATED", () => {
    expect(shouldAutoClearCsFlag("LABEL_CREATED", true)).toBe(true);
  });

  it("clears csFlag when moving to SHIPPED", () => {
    expect(shouldAutoClearCsFlag("SHIPPED", true)).toBe(true);
  });

  it("clears csFlag when moving to DELIVERED", () => {
    expect(shouldAutoClearCsFlag("DELIVERED", true)).toBe(true);
  });

  it("clears csFlag when moving to PICKED_UP", () => {
    expect(shouldAutoClearCsFlag("PICKED_UP", true)).toBe(true);
  });

  it("does NOT clear csFlag when staying in OPEN", () => {
    expect(shouldAutoClearCsFlag("OPEN", true)).toBe(false);
  });

  it("does NOT clear csFlag when staying in REVIEW", () => {
    expect(shouldAutoClearCsFlag("REVIEW", true)).toBe(false);
  });

  it("returns false when csFlag is already false", () => {
    expect(shouldAutoClearCsFlag("SHIPPED", false)).toBe(false);
  });
});
