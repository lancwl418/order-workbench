/**
 * Fetch a remote PNG and read its pixel dimensions + DPI by parsing
 * only the PNG header chunks (IHDR + pHYs). This avoids downloading
 * the entire file, which can be 300MB+ for large gang sheets.
 */
export async function getPngDimensions(
  url: string
): Promise<{ widthPx: number; heightPx: number; dpi: number; heightInches: number }> {
  // PNG header info is in the first few KB. Fetch 64KB to cover IHDR + pHYs.
  const res = await fetch(url, {
    headers: { Range: "bytes=0-65535" },
  });

  if (!res.ok && res.status !== 206) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  // Validate PNG signature
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("Not a valid PNG file");
  }

  // Parse IHDR (always the first chunk, at offset 8)
  const widthPx = buf.readUInt32BE(16);
  const heightPx = buf.readUInt32BE(20);

  // Walk chunks to find pHYs for DPI
  let dpi = 300; // fallback
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(offset);
    const chunkType = buf.toString("ascii", offset + 4, offset + 8);

    if (chunkType === "pHYs" && chunkLen === 9 && offset + 12 + 9 <= buf.length) {
      const pxPerUnitX = buf.readUInt32BE(offset + 8);
      const unit = buf[offset + 8 + 8]; // 1 = meter
      if (unit === 1 && pxPerUnitX > 0) {
        dpi = Math.round(pxPerUnitX * 0.0254);
      }
      break;
    }

    // Stop scanning once we hit image data
    if (chunkType === "IDAT") break;

    // Move to next chunk: 4 (length) + 4 (type) + data + 4 (CRC)
    offset += 4 + 4 + chunkLen + 4;
  }

  const heightInches = heightPx / dpi;

  return { widthPx, heightPx, dpi, heightInches };
}
