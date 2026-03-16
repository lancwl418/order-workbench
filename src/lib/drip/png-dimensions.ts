import sharp from "sharp";

// Disable sharp/libvips disk cache to prevent /tmp from filling up
sharp.cache(false);

/**
 * Fetch a remote PNG and read its actual pixel dimensions + DPI.
 * Height in inches is calculated from real DPI metadata, not assumed.
 */
export async function getPngDimensions(
  url: string
): Promise<{ widthPx: number; heightPx: number; dpi: number; heightInches: number }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata();

  const widthPx = meta.width || 0;
  const heightPx = meta.height || 0;
  const dpi = meta.density || 300; // fallback 300 if not embedded

  const heightInches = heightPx / dpi;

  return { widthPx, heightPx, dpi, heightInches };
}
