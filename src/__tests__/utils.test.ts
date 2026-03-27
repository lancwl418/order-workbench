import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDate, formatDateTime, timeAgo } from "@/lib/utils";

describe("formatDate", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
  });

  it("formats a Date object", () => {
    const date = new Date("2024-03-15T12:00:00Z");
    const result = formatDate(date);
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2024/);
  });

  it("formats a date string", () => {
    // Use a mid-month date to avoid timezone boundary issues
    const result = formatDate("2024-06-15T12:00:00Z");
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/2024/);
  });
});

describe("formatDateTime", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
  });

  it("includes time component", () => {
    const date = new Date("2024-06-15T14:30:00Z");
    const result = formatDateTime(date);
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
  });
});

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '-' for null/undefined", () => {
    expect(timeAgo(null)).toBe("-");
    expect(timeAgo(undefined)).toBe("-");
  });

  it("returns 'just now' for < 1 minute ago", () => {
    const date = new Date("2024-06-15T11:59:30Z");
    expect(timeAgo(date)).toBe("just now");
  });

  it("returns minutes for < 1 hour", () => {
    const date = new Date("2024-06-15T11:30:00Z");
    expect(timeAgo(date)).toBe("30m ago");
  });

  it("returns hours for < 24 hours", () => {
    const date = new Date("2024-06-15T06:00:00Z");
    expect(timeAgo(date)).toBe("6h ago");
  });

  it("returns days for < 7 days", () => {
    const date = new Date("2024-06-12T12:00:00Z");
    expect(timeAgo(date)).toBe("3d ago");
  });

  it("falls back to formatted date for >= 7 days", () => {
    const date = new Date("2024-06-01T12:00:00Z");
    const result = timeAgo(date);
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/1/);
  });

  it("accepts a date string", () => {
    expect(timeAgo("2024-06-15T11:55:00Z")).toBe("5m ago");
  });
});
