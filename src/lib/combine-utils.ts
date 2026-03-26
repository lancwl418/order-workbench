export type Piece = {
  filePath: string;
  width: number;
  height: number;
  isSeparator?: boolean;
  orderId?: string;
};

export const DEFAULT_MAX_CHUNK_HEIGHT = 80000;
export const ORDER_MARGIN = 90;

/**
 * Split pieces into chunks that don't exceed maxChunkHeight.
 * Ensures separators (order number / customer name) are never split
 * from their following images — they always start the next chunk together.
 */
export function splitIntoChunks(
  pieces: Piece[],
  maxChunkHeight = DEFAULT_MAX_CHUNK_HEIGHT
): Piece[][] {
  const chunks: Piece[][] = [];
  let currentChunk: Piece[] = [];
  let currentHeight = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];

    if (
      currentHeight + piece.height > maxChunkHeight &&
      currentChunk.length > 0
    ) {
      // Before finalising this chunk, pull any trailing separators back —
      // they belong with the images that follow in the next chunk.
      const trailingSeps: Piece[] = [];
      while (
        currentChunk.length > 0 &&
        currentChunk[currentChunk.length - 1].isSeparator
      ) {
        const sep = currentChunk.pop()!;
        currentHeight -= sep.height;
        trailingSeps.unshift(sep);
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      // Start next chunk with the pulled-back separators
      currentChunk = [...trailingSeps];
      currentHeight = trailingSeps.reduce((s, p) => s + p.height, 0);
    }

    currentChunk.push(piece);
    currentHeight += piece.height;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Continuation-separator planning (pure logic, no I/O)
// ---------------------------------------------------------------------------

/** A new separator that must be inserted at the start of a chunk. */
export type ContinuationInsert = {
  chunkIndex: number;
  orderId: string;
};

/** An existing or newly-inserted separator whose label must be updated. */
export type SeparatorLabel = {
  chunkIndex: number;
  /** Piece index *after* all insertions have been applied. */
  pieceIndex: number;
  orderId: string;
  paginatedLabel: string;
};

export type ContinuationPlan = {
  inserts: ContinuationInsert[];
  labels: SeparatorLabel[];
};

/**
 * Analyse chunks that were produced by `splitIntoChunks` and return a plan
 * describing what continuation separators need to be inserted and which
 * separator labels need to be updated with pagination (e.g. "(1/3)").
 *
 * This is a **pure function** — it does not mutate `chunks` or perform I/O.
 * The caller is responsible for executing the plan (creating PNGs, etc.).
 */
export function planContinuations(
  chunks: Piece[][],
  orderLabels: Map<string, string>
): ContinuationPlan {
  // 1. Find which chunk indices each order's *images* appear in
  const orderChunkIndices = new Map<string, number[]>();
  for (let c = 0; c < chunks.length; c++) {
    const seen = new Set<string>();
    for (const piece of chunks[c]) {
      if (piece.orderId && !piece.isSeparator && !seen.has(piece.orderId)) {
        seen.add(piece.orderId);
        if (!orderChunkIndices.has(piece.orderId))
          orderChunkIndices.set(piece.orderId, []);
        orderChunkIndices.get(piece.orderId)!.push(c);
      }
    }
  }

  // 2. Identify orders spanning multiple chunks
  const splitOrders = new Set<string>();
  for (const [oid, indices] of orderChunkIndices) {
    if (indices.length > 1) splitOrders.add(oid);
  }

  if (splitOrders.size === 0) return { inserts: [], labels: [] };

  // 3. Determine where continuation separators must be inserted
  const inserts: ContinuationInsert[] = [];
  for (let c = 1; c < chunks.length; c++) {
    const first = chunks[c][0];
    if (
      !first.isSeparator &&
      first.orderId &&
      splitOrders.has(first.orderId)
    ) {
      inserts.push({ chunkIndex: c, orderId: first.orderId });
    }
  }

  // 4. Build paginated labels for every separator of every split order.
  //    Walk chunks in order, accounting for the insertions above.
  const insertSet = new Set(inserts.map((ins) => ins.chunkIndex));
  const partCounter = new Map<string, number>();
  for (const oid of splitOrders) partCounter.set(oid, 1);

  const totalParts = new Map<string, number>();
  for (const [oid, indices] of orderChunkIndices) {
    if (splitOrders.has(oid)) totalParts.set(oid, indices.length);
  }

  const labels: SeparatorLabel[] = [];

  for (let c = 0; c < chunks.length; c++) {
    // If this chunk will receive an inserted separator, account for it first
    const hasInsert = insertSet.has(c);
    if (hasInsert) {
      const ins = inserts.find((i) => i.chunkIndex === c)!;
      const oid = ins.orderId;
      const part = partCounter.get(oid)!;
      const total = totalParts.get(oid)!;
      const base = orderLabels.get(oid) || "";
      labels.push({
        chunkIndex: c,
        pieceIndex: 0, // inserted at position 0
        orderId: oid,
        paginatedLabel: `${base} (${part}/${total})`,
      });
      partCounter.set(oid, part + 1);
    }

    // Now walk existing pieces (shifted by 1 if an insert happened)
    const offset = hasInsert ? 1 : 0;
    for (let p = 0; p < chunks[c].length; p++) {
      const piece = chunks[c][p];
      if (
        piece.isSeparator &&
        piece.orderId &&
        splitOrders.has(piece.orderId)
      ) {
        const oid = piece.orderId;
        const part = partCounter.get(oid)!;
        const total = totalParts.get(oid)!;
        const base = orderLabels.get(oid) || "";
        labels.push({
          chunkIndex: c,
          pieceIndex: p + offset,
          orderId: oid,
          paginatedLabel: `${base} (${part}/${total})`,
        });
        partCounter.set(oid, part + 1);
      }
    }
  }

  return { inserts, labels };
}
