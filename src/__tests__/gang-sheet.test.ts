import { describe, it, expect, vi, beforeEach } from "vitest";
import { isDirectImageUrl, resolveGangSheetUrls } from "@/lib/drip/resolve-gang-sheet";

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

  it("returns false for dripappsserver print-ready page URLs", () => {
    expect(
      isDirectImageUrl("https://app.dripappsserver.com/shopify/gang/print-ready?gang_id=123")
    ).toBe(false);
  });
});

describe("resolveGangSheetUrls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns resolved files with ?dt= cache buster from updated_at", async () => {
    const pageData = {
      props: {
        designs: [
          {
            gang_sheet_url: "https://images.dripappsserver.com/production/gang_sheets/123/sheet.png",
            file_name: "order-1234-sheet.png",
            status: "completed",
            updated_at: "2026-03-27T19:12:48.000000Z",
          },
        ],
      },
    };
    const encodedData = JSON.stringify(pageData).replace(/"/g, "&quot;");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: (name: string) => name === "location" ? "https://app.dripappsserver.com/redirect" : null,
          getSetCookie: () => ["session=abc123; Path=/"],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div id="app" data-page="${encodedData}"></div>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://app.dripappsserver.com/shopify/gang/print-ready?gang_id=123");

    expect(result).toEqual([
      {
        url: "https://images.dripappsserver.com/production/gang_sheets/123/sheet.png?dt=1774638768",
        filename: "order-1234-sheet.png",
      },
    ]);
  });

  it("passes cache: no-store to both fetch calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://app.dripappsserver.com/redirect",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="{}"></div>`,
      } as unknown as Response);

    await resolveGangSheetUrls("https://example.com/print-ready");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
  });

  it("forwards cookies from initial redirect to page fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://app.dripappsserver.com/redirect",
          getSetCookie: () => ["session=abc; Path=/", "token=xyz; HttpOnly"],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="{}"></div>`,
      } as unknown as Response);

    await resolveGangSheetUrls("https://example.com/print-ready");

    expect(fetchSpy.mock.calls[1][1]).toMatchObject({
      headers: { cookie: "session=abc; token=xyz" },
    });
  });

  it("returns empty array when no redirect location", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: {
        get: () => null,
        getSetCookie: () => [],
      },
    } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    expect(result).toEqual([]);
  });

  it("returns empty array when no data-page attribute found", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://redirect.com",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<html><body>No inertia data</body></html>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    expect(result).toEqual([]);
  });

  it("filters out non-completed designs", async () => {
    const pageData = {
      props: {
        designs: [
          { gang_sheet_url: "https://img.com/a.png", file_name: "a.png", status: "completed", updated_at: "2026-01-01T00:00:00.000000Z" },
          { gang_sheet_url: "https://img.com/b.png", file_name: "b.png", status: "processing", updated_at: "2026-01-01T00:00:00.000000Z" },
          { gang_sheet_url: null, file_name: "c.png", status: "completed" },
        ],
      },
    };
    const encodedData = JSON.stringify(pageData).replace(/"/g, "&quot;");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://redirect.com",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="${encodedData}"></div>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    const expectedTs = Math.floor(new Date("2026-01-01T00:00:00.000000Z").getTime() / 1000);
    expect(result).toEqual([{ url: `https://img.com/a.png?dt=${expectedTs}`, filename: "a.png" }]);
  });

  it("uses fallback filename when file_name is missing", async () => {
    const pageData = {
      props: {
        designs: [
          { gang_sheet_url: "https://img.com/a.png", status: "completed" },
        ],
      },
    };
    const encodedData = JSON.stringify(pageData).replace(/"/g, "&quot;");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://redirect.com",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="${encodedData}"></div>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    expect(result).toEqual([{ url: "https://img.com/a.png", filename: "gang-sheet.png" }]);
  });

  it("omits ?dt= when updated_at is missing", async () => {
    const pageData = {
      props: {
        designs: [
          { gang_sheet_url: "https://img.com/a.png", file_name: "a.png", status: "completed" },
        ],
      },
    };
    const encodedData = JSON.stringify(pageData).replace(/"/g, "&quot;");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://redirect.com",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="${encodedData}"></div>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    expect(result[0].url).toBe("https://img.com/a.png");
  });

  it("returns empty array when fetch throws an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    expect(result).toEqual([]);
  });

  it("decodes HTML entities in data-page attribute", async () => {
    const pageData = {
      props: {
        designs: [
          { gang_sheet_url: "https://img.com/a.png?foo=1&bar=2", file_name: "test.png", status: "completed", updated_at: "2026-06-15T12:00:00.000000Z" },
        ],
      },
    };
    // Simulate HTML-encoded JSON with &amp; for &
    const encodedData = JSON.stringify(pageData)
      .replace(/"/g, "&quot;")
      .replace(/&/g, "&amp;");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        headers: {
          get: () => "https://redirect.com",
          getSetCookie: () => [],
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        text: async () => `<div data-page="${encodedData}"></div>`,
      } as unknown as Response);

    const result = await resolveGangSheetUrls("https://example.com/print-ready");
    const expectedTs = Math.floor(new Date("2026-06-15T12:00:00.000000Z").getTime() / 1000);
    // dt= is appended after existing query params with &
    expect(result[0].url).toBe(`https://img.com/a.png?foo=1&bar=2&dt=${expectedTs}`);
  });
});
