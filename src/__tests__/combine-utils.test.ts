import { describe, it, expect } from "vitest";
import {
  splitIntoChunks,
  planContinuations,
  type Piece,
} from "@/lib/combine-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to create an image piece. */
function img(
  orderId: string,
  height: number,
  filePath = "img.png"
): Piece {
  return { filePath, width: 6600, height, orderId };
}

/** Shorthand to create a separator piece. */
function sep(orderId: string, filePath = "sep.png"): Piece {
  return {
    filePath,
    width: 6600,
    height: 90,
    isSeparator: true,
    orderId,
  };
}

/** Extract just orderId + isSeparator for easy snapshot assertions. */
function simplify(chunks: Piece[][]) {
  return chunks.map((chunk) =>
    chunk.map((p) => (p.isSeparator ? `sep:${p.orderId}` : `img:${p.orderId}`))
  );
}

// ---------------------------------------------------------------------------
// splitIntoChunks
// ---------------------------------------------------------------------------

describe("splitIntoChunks", () => {
  it("returns a single chunk when total height is under the limit", () => {
    const pieces = [sep("A"), img("A", 500), sep("B"), img("B", 400)];
    const chunks = splitIntoChunks(pieces, 2000);

    expect(chunks).toHaveLength(1);
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A", "sep:B", "img:B"],
    ]);
  });

  it("splits into multiple chunks at the height boundary", () => {
    // maxHeight = 1000, images are 600px each → must split
    const pieces = [
      sep("A"),
      img("A", 600),
      sep("B"),
      img("B", 600),
    ];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(2);
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A"],
      ["sep:B", "img:B"],
    ]);
  });

  it("never leaves a separator at the end of a chunk", () => {
    // sep:A(90) + img:A(800) + sep:B(90) = 980 → under 1000
    // But adding img:B(800) pushes over → split happens.
    // Without the fix, sep:B would stay in chunk 1.
    const pieces = [
      sep("A"),
      img("A", 800),
      sep("B"),
      img("B", 800),
    ];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(2);
    // sep:B must move to chunk 2 together with img:B
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A"],
      ["sep:B", "img:B"],
    ]);
  });

  it("pulls back multiple consecutive trailing separators", () => {
    // Edge case: two separators at the end (e.g. empty order followed by another)
    const pieces = [
      img("A", 900),
      sep("B"),
      sep("C"),
      img("C", 500),
    ];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(2);
    expect(simplify(chunks)).toEqual([
      ["img:A"],
      ["sep:B", "sep:C", "img:C"],
    ]);
  });

  it("handles a single very tall image gracefully", () => {
    // One image taller than maxHeight — can't split it, so it goes in one chunk
    const pieces = [sep("A"), img("A", 5000)];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(1);
    expect(simplify(chunks)).toEqual([["sep:A", "img:A"]]);
  });

  it("keeps all images of one order together when they fit", () => {
    const pieces = [
      sep("A"),
      img("A", 200),
      img("A", 200),
      img("A", 200),
      sep("B"),
      img("B", 200),
    ];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(1);
  });

  it("splits a large order across chunks (mid-order split)", () => {
    // Order A has 3 images of 400px each; maxHeight = 1000
    // sep(90) + img(400) + img(400) = 890 < 1000
    // Adding 3rd img(400) → 1290 > 1000 → split
    const pieces = [
      sep("A"),
      img("A", 400),
      img("A", 400),
      img("A", 400),
    ];
    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(2);
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A", "img:A"],
      ["img:A"],
    ]);
  });

  it("handles empty input", () => {
    expect(splitIntoChunks([], 1000)).toEqual([]);
  });

  it("handles only separators (edge case)", () => {
    const pieces = [sep("A"), sep("B"), sep("C")];
    const chunks = splitIntoChunks(pieces, 200);

    // All pieces are separators — they all get pulled back when a split
    // is attempted (no image to anchor a chunk), so they end up together.
    expect(chunks).toHaveLength(1);
    expect(simplify(chunks)).toEqual([["sep:A", "sep:B", "sep:C"]]);
  });
});

// ---------------------------------------------------------------------------
// planContinuations
// ---------------------------------------------------------------------------

describe("planContinuations", () => {
  it("returns empty plan when no order spans multiple chunks", () => {
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500)],
      [sep("B"), img("B", 500)],
    ];
    const labels = new Map([
      ["A", "#100 — Alice"],
      ["B", "#200 — Bob"],
    ]);
    const plan = planContinuations(chunks, labels);

    expect(plan.inserts).toEqual([]);
    expect(plan.labels).toEqual([]);
  });

  it("detects a single order split across 2 chunks", () => {
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500), img("A", 500)],
      [img("A", 500)], // continues without separator
    ];
    const labels = new Map([["A", "#100 — Alice"]]);
    const plan = planContinuations(chunks, labels);

    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toEqual({ chunkIndex: 1, orderId: "A" });

    expect(plan.labels).toHaveLength(2);
    // First separator in chunk 0 → (1/2)
    expect(plan.labels[0].paginatedLabel).toBe("#100 — Alice (1/2)");
    expect(plan.labels[0].chunkIndex).toBe(0);
    // Continuation separator in chunk 1 → (2/2)
    expect(plan.labels[1].paginatedLabel).toBe("#100 — Alice (2/2)");
    expect(plan.labels[1].chunkIndex).toBe(1);
  });

  it("handles an order split across 3 chunks", () => {
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500)],
      [img("A", 500)],
      [img("A", 500)],
    ];
    const labels = new Map([["A", "#100 — Alice"]]);
    const plan = planContinuations(chunks, labels);

    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts.map((i) => i.chunkIndex)).toEqual([1, 2]);

    expect(plan.labels).toHaveLength(3);
    expect(plan.labels[0].paginatedLabel).toBe("#100 — Alice (1/3)");
    expect(plan.labels[1].paginatedLabel).toBe("#100 — Alice (2/3)");
    expect(plan.labels[2].paginatedLabel).toBe("#100 — Alice (3/3)");
  });

  it("does not touch orders that fit in one chunk", () => {
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500), sep("B"), img("B", 300)],
      [img("B", 500)], // B spans 2 chunks, A doesn't
    ];
    const labels = new Map([
      ["A", "#100 — Alice"],
      ["B", "#200 — Bob"],
    ]);
    const plan = planContinuations(chunks, labels);

    // Only B should be affected
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].orderId).toBe("B");

    // Only B's separators get pagination labels
    const affectedOrders = new Set(plan.labels.map((l) => l.orderId));
    expect(affectedOrders).toEqual(new Set(["B"]));
    expect(plan.labels).toHaveLength(2);
    expect(plan.labels[0].paginatedLabel).toBe("#200 — Bob (1/2)");
    expect(plan.labels[1].paginatedLabel).toBe("#200 — Bob (2/2)");
  });

  it("handles multiple orders each split across chunks", () => {
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500)],
      [img("A", 500), sep("B"), img("B", 300)],
      [img("B", 500)],
    ];
    const labels = new Map([
      ["A", "#100 — Alice"],
      ["B", "#200 — Bob"],
    ]);
    const plan = planContinuations(chunks, labels);

    // A continues in chunk 1, B continues in chunk 2
    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts[0]).toEqual({ chunkIndex: 1, orderId: "A" });
    expect(plan.inserts[1]).toEqual({ chunkIndex: 2, orderId: "B" });

    // A gets (1/2) and (2/2), B gets (1/2) and (2/2)
    const aLabels = plan.labels.filter((l) => l.orderId === "A");
    const bLabels = plan.labels.filter((l) => l.orderId === "B");

    expect(aLabels).toHaveLength(2);
    expect(aLabels[0].paginatedLabel).toBe("#100 — Alice (1/2)");
    expect(aLabels[1].paginatedLabel).toBe("#100 — Alice (2/2)");

    expect(bLabels).toHaveLength(2);
    expect(bLabels[0].paginatedLabel).toBe("#200 — Bob (1/2)");
    expect(bLabels[1].paginatedLabel).toBe("#200 — Bob (2/2)");
  });

  it("does not insert if the chunk already starts with a separator for that order", () => {
    // This shouldn't normally happen after splitIntoChunks, but guard anyway
    const chunks: Piece[][] = [
      [sep("A"), img("A", 500)],
      [sep("A"), img("A", 500)], // already has a separator
    ];
    const labels = new Map([["A", "#100 — Alice"]]);
    const plan = planContinuations(chunks, labels);

    // No insertion needed — chunk 1 already starts with sep:A
    expect(plan.inserts).toHaveLength(0);

    // But both existing separators should get pagination
    expect(plan.labels).toHaveLength(2);
    expect(plan.labels[0].paginatedLabel).toBe("#100 — Alice (1/2)");
    expect(plan.labels[1].paginatedLabel).toBe("#100 — Alice (2/2)");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: splitIntoChunks → planContinuations
// ---------------------------------------------------------------------------

describe("split + plan integration", () => {
  it("separator stays with images and split order gets pagination", () => {
    // Simulate: Order A (small), Order B (large, spans 2 chunks), Order C (small)
    const pieces: Piece[] = [
      sep("A"),
      img("A", 200),
      sep("B"),
      img("B", 400),
      img("B", 400),
      img("B", 400),
      sep("C"),
      img("C", 200),
    ];
    const labels = new Map([
      ["A", "#100 — Alice"],
      ["B", "#200 — Bob"],
      ["C", "#300 — Carol"],
    ]);

    // maxHeight = 1000
    // Chunk 1: sep:A(90) + img:A(200) + sep:B(90) + img:B(400) + img:B(400) = 1180 > 1000
    //   → split after img:B(400) #1 → sep:A(90)+img:A(200)+sep:B(90)+img:B(400) = 780
    //   Actually let me trace:
    //   i=0: sep:A(90) → 90 < 1000, add
    //   i=1: img:A(200) → 290 < 1000, add
    //   i=2: sep:B(90) → 380 < 1000, add
    //   i=3: img:B(400) → 780 < 1000, add
    //   i=4: img:B(400) → 1180 > 1000 → split! No trailing seps. Push chunk.
    //   Chunk 2 starts with img:B(400)
    //   i=5: img:B(400) → 800 < 1000, add
    //   i=6: sep:C(90) → 890 < 1000, add
    //   i=7: img:C(200) → 1090 > 1000 → split! Trailing sep:C pulled back.
    //   Push [img:B, img:B]. Chunk 3 = [sep:C, img:C]

    const chunks = splitIntoChunks(pieces, 1000);

    expect(chunks).toHaveLength(3);
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A", "sep:B", "img:B"],
      ["img:B", "img:B"],
      ["sep:C", "img:C"],
    ]);

    // Plan continuations
    const plan = planContinuations(chunks, labels);

    // B spans chunks 0 and 1 → needs continuation in chunk 1
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toEqual({ chunkIndex: 1, orderId: "B" });

    // B gets pagination: (1/2) in chunk 0, (2/2) in chunk 1
    expect(plan.labels).toHaveLength(2);
    expect(plan.labels[0].paginatedLabel).toBe("#200 — Bob (1/2)");
    expect(plan.labels[1].paginatedLabel).toBe("#200 — Bob (2/2)");

    // A and C are untouched (no pagination needed)
    expect(plan.labels.every((l) => l.orderId === "B")).toBe(true);
  });

  it("complex scenario: 2 split orders + 1 single-chunk order", () => {
    const pieces: Piece[] = [
      sep("A"),
      img("A", 300),
      img("A", 300),
      img("A", 300),
      sep("B"),
      img("B", 100),
      sep("C"),
      img("C", 300),
      img("C", 300),
      img("C", 300),
    ];
    const labels = new Map([
      ["A", "#1 — A"],
      ["B", "#2 — B"],
      ["C", "#3 — C"],
    ]);

    // maxHeight = 800
    // i=0: sep:A(90) → 90
    // i=1: img:A(300) → 390
    // i=2: img:A(300) → 690
    // i=3: img:A(300) → 990 > 800 → split! Push [sep:A, img:A, img:A]. Chunk 2 = [img:A(300)]
    // i=4: sep:B(90) → 390
    // i=5: img:B(100) → 490
    // i=6: sep:C(90) → 580
    // i=7: img:C(300) → 880 > 800 → split! Trailing sep:C pulled. Push [img:A, sep:B, img:B]. Chunk 3 = [sep:C, img:C(300)]
    // i=8: img:C(300) → 690
    // i=9: img:C(300) → 990 > 800 → split! Push [sep:C, img:C, img:C]. Chunk 4 = [img:C(300)]

    const chunks = splitIntoChunks(pieces, 800);

    expect(chunks).toHaveLength(4);
    expect(simplify(chunks)).toEqual([
      ["sep:A", "img:A", "img:A"],
      ["img:A", "sep:B", "img:B"],
      ["sep:C", "img:C", "img:C"],
      ["img:C"],
    ]);

    const plan = planContinuations(chunks, labels);

    // A spans chunks 0,1 → continuation in chunk 1
    // B is only in chunk 1 → no continuation
    // C spans chunks 2,3 → continuation in chunk 3
    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts[0]).toEqual({ chunkIndex: 1, orderId: "A" });
    expect(plan.inserts[1]).toEqual({ chunkIndex: 3, orderId: "C" });

    const aLabels = plan.labels.filter((l) => l.orderId === "A");
    const cLabels = plan.labels.filter((l) => l.orderId === "C");

    expect(aLabels[0].paginatedLabel).toBe("#1 — A (1/2)");
    expect(aLabels[1].paginatedLabel).toBe("#1 — A (2/2)");
    expect(cLabels[0].paginatedLabel).toBe("#3 — C (1/2)");
    expect(cLabels[1].paginatedLabel).toBe("#3 — C (2/2)");

    // B is not split, should have no labels
    expect(plan.labels.filter((l) => l.orderId === "B")).toHaveLength(0);
  });
});
