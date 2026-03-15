import { describe, it, expect } from "vitest";
import { differenceInBusinessDays } from "@/lib/exceptions/business-days";

describe("differenceInBusinessDays", () => {
  it("returns 0 for the same day", () => {
    const date = new Date("2024-06-10T12:00:00Z"); // Monday
    expect(differenceInBusinessDays(date, date)).toBe(0);
  });

  it("counts weekdays only (Mon-Fri)", () => {
    const monday = new Date("2024-06-10T12:00:00Z");
    const friday = new Date("2024-06-14T12:00:00Z");
    expect(differenceInBusinessDays(friday, monday)).toBe(4);
  });

  it("skips weekends", () => {
    const friday = new Date("2024-06-14T12:00:00Z");
    const nextMonday = new Date("2024-06-17T12:00:00Z");
    // Friday to Monday = 1 business day (skipping Sat/Sun)
    expect(differenceInBusinessDays(nextMonday, friday)).toBe(1);
  });

  it("calculates full week correctly (5 business days)", () => {
    const monday = new Date("2024-06-10T12:00:00Z");
    const nextMonday = new Date("2024-06-17T12:00:00Z");
    expect(differenceInBusinessDays(nextMonday, monday)).toBe(5);
  });

  it("two weeks = 10 business days", () => {
    const monday = new Date("2024-06-10T12:00:00Z");
    const twoWeeksLater = new Date("2024-06-24T12:00:00Z");
    expect(differenceInBusinessDays(twoWeeksLater, monday)).toBe(10);
  });

  it("handles negative difference (dateLeft < dateRight)", () => {
    const monday = new Date("2024-06-10T12:00:00Z");
    const friday = new Date("2024-06-14T12:00:00Z");
    expect(differenceInBusinessDays(monday, friday)).toBe(-4);
  });

  it("Saturday to Monday = 0 business days (weekends skipped)", () => {
    const saturday = new Date("2024-06-15T12:00:00Z");
    const monday = new Date("2024-06-17T12:00:00Z");
    // date-fns: Sat and Sun are not business days, so Sat->Mon = 0
    expect(differenceInBusinessDays(monday, saturday)).toBe(0);
  });
});
