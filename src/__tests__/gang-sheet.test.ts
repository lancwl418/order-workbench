import { describe, it, expect } from "vitest";
import { isDirectImageUrl } from "@/lib/drip/resolve-gang-sheet";

describe("isDirectImageUrl", () => {
  it("recognizes /uploads/ paths as direct images", () => {
    expect(isDirectImageUrl("https://example.com/uploads/image.png")).toBe(true);
  });

  it("recognizes dripappsserver.com images", () => {
    expect(
      isDirectImageUrl("https://images.dripappsserver.com/123/sheet.png")
    ).toBe(true);
  });

  it("recognizes R2 dev URLs", () => {
    expect(
      isDirectImageUrl("https://my-bucket.r2.dev/files/image.png")
    ).toBe(true);
  });

  it("recognizes R2 cloudflare storage URLs", () => {
    expect(
      isDirectImageUrl(
        "https://account.r2.cloudflarestorage.com/bucket/file.png"
      )
    ).toBe(true);
  });

  it("returns false for Transfer by Size page URLs", () => {
    expect(
      isDirectImageUrl("https://transferbysize.com/orders/12345/print-ready")
    ).toBe(false);
  });

  it("returns false for generic URLs", () => {
    expect(isDirectImageUrl("https://example.com/page")).toBe(false);
  });
});
