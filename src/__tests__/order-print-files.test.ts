import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveGangSheetUrls = vi.fn();
vi.mock("@/lib/drip/resolve-gang-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/drip/resolve-gang-sheet")>();
  return {
    ...actual,
    resolveGangSheetUrls: (...args: unknown[]) => mockResolveGangSheetUrls(...args),
  };
});

import {
  groupPrintFileSources,
  resolvePrintFileSource,
  resolveOrderPrintFiles,
  type PrintFileItem,
} from "@/lib/drip/order-print-files";

function item(over: Partial<PrintFileItem>): PrintFileItem {
  return {
    id: "i1",
    title: "Item",
    variantTitle: null,
    quantity: 1,
    itemType: "other",
    designFileUrl: null,
    originalDesignFileUrl: null,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("groupPrintFileSources", () => {
  it("groups items by url and sums ready print copies", () => {
    const groups = groupPrintFileSources([
      item({ id: "a", itemType: "transfer_by_size", designFileUrl: "https://drip/page" }),
      item({ id: "b", itemType: "transfer_by_size", designFileUrl: "https://drip/page" }),
      item({ id: "c", itemType: "ready_print", quantity: 3, designFileUrl: "https://x/ready.png", title: "Russell Sprinkle" }),
      item({ id: "d", itemType: "ready_print", quantity: 2, designFileUrl: "https://x/ready.png" }),
      item({ id: "e", designFileUrl: null }),
    ]);
    expect(groups).toEqual([
      { url: "https://drip/page", label: "Item", itemIds: ["a", "b"], originalUrl: null, copies: 1 },
      { url: "https://x/ready.png", label: "Russell Sprinkle", itemIds: ["c", "d"], originalUrl: null, copies: 5 },
    ]);
  });
});

describe("resolvePrintFileSource", () => {
  it("repeats a ready print sheet once per copy with 'i of n' names", async () => {
    const files = await resolvePrintFileSource("https://cdn.shopify.com/files/sheet.png", {
      orderNum: "4486",
      label: "russell sprinkle",
      copies: 3,
    });
    expect(files).toEqual([
      { url: "https://cdn.shopify.com/files/sheet.png", filename: "4486-russell sprinkle-1 of 3.png" },
      { url: "https://cdn.shopify.com/files/sheet.png", filename: "4486-russell sprinkle-2 of 3.png" },
      { url: "https://cdn.shopify.com/files/sheet.png", filename: "4486-russell sprinkle-3 of 3.png" },
    ]);
    expect(mockResolveGangSheetUrls).not.toHaveBeenCalled();
  });

  it("returns a single direct image unchanged", async () => {
    expect(
      await resolvePrintFileSource("https://drip/uploads/a.png", { orderNum: "1", label: "Gang" })
    ).toEqual([{ url: "https://drip/uploads/a.png", filename: "1-Gang.png" }]);
  });

  it("resolves Transfer by Size pages through Drip", async () => {
    mockResolveGangSheetUrls.mockResolvedValue([{ url: "https://cdn/1.png", filename: "1 of 1.png" }]);
    expect(
      await resolvePrintFileSource("https://drip/page", { orderNum: "1", label: "TbS" })
    ).toEqual([{ url: "https://cdn/1.png", filename: "1 of 1.png" }]);
  });
});

describe("resolveOrderPrintFiles", () => {
  it("keeps the normal transfer files and adds the ready print set", async () => {
    mockResolveGangSheetUrls.mockResolvedValue([
      { url: "https://cdn/1.png", filename: "4486-tbs-1 of 2.png" },
      { url: "https://cdn/2.png", filename: "4486-tbs-2 of 2.png" },
    ]);
    const files = await resolveOrderPrintFiles({
      shopifyOrderNumber: "#4486",
      orderItems: [
        item({ id: "a", itemType: "transfer_by_size", designFileUrl: "https://drip/page" }),
        item({ id: "c", itemType: "ready_print", quantity: 2, designFileUrl: "https://x/ready.png", title: "Ready" }),
      ],
      extraPrintFiles: [{ url: "https://r2/extra.png", filename: "extra.png" }],
    });
    expect(files.map((f) => f.filename)).toEqual([
      "4486-tbs-1 of 2.png",
      "4486-tbs-2 of 2.png",
      "4486-Ready-1 of 2.png",
      "4486-Ready-2 of 2.png",
      "extra.png",
    ]);
  });
});
