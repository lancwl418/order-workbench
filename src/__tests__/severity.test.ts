import { describe, it, expect } from "vitest";
import { severityByDays } from "@/lib/exceptions/detector";

describe("severityByDays", () => {
  it("returns LOW for 0 days", () => {
    expect(severityByDays(0)).toBe("LOW");
  });

  it("returns LOW for 1 day", () => {
    expect(severityByDays(1)).toBe("LOW");
  });

  it("returns LOW for 2 days", () => {
    expect(severityByDays(2)).toBe("LOW");
  });

  it("returns MEDIUM for 3 days", () => {
    expect(severityByDays(3)).toBe("MEDIUM");
  });

  it("returns MEDIUM for 4 days", () => {
    expect(severityByDays(4)).toBe("MEDIUM");
  });

  it("returns MEDIUM for 5 days", () => {
    expect(severityByDays(5)).toBe("MEDIUM");
  });

  it("returns HIGH for 6 days", () => {
    expect(severityByDays(6)).toBe("HIGH");
  });

  it("returns HIGH for 10 days", () => {
    expect(severityByDays(10)).toBe("HIGH");
  });
});
