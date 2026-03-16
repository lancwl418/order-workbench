import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";

// Allow up to 5 minutes for large image processing
export const maxDuration = 300;

const MAX_WIDTH = 6600; // 22 inches at 300 DPI
const ORDER_MARGIN = 90; // separator height in px

function orderSeparatorSvg(
  text: string,
  canvasWidth: number,
  height: number,
  fontSize = 48
): Buffer {
  const lineY = height * 0.3;
  const textY = height * 0.85;
  const svg = `<svg width="${canvasWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${canvasWidth}" height="${height}" fill="white"/>
    <line x1="0" y1="${lineY}" x2="${canvasWidth}" y2="${lineY}" stroke="black" stroke-width="3" stroke-dasharray="20,12"/>
    <text x="20" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="black">${text}</text>
  </svg>`;
  return Buffer.from(svg);
}

/**
 * GET /api/print-groups/:id/download
 *
 * Fetches all gang sheet PNGs in the group, stitches them vertically
 * into one combined image, and returns it as a PNG download.
 *
 * Memory-optimised: downloads images to temp files one at a time,
 * uses file paths in composite (libvips loads from disk on demand),
 * and writes output to a temp file before streaming.
 * This keeps memory well under 512MB even for very large images.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.printGroup.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          order: {
            select: { shopifyOrderNumber: true, customerName: true },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.items.length === 0) {
    return NextResponse.json({ error: "Group has no files" }, { status: 400 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "combine-"));

  try {
    // Download images ONE AT A TIME to temp files to minimize memory usage
    const images: {
      filePath: string;
      width: number;
      height: number;
      orderId: string;
      label: string;
    }[] = [];

    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const tmpPath = path.join(tmpDir, `${i}.png`);

      const res = await fetch(item.fileUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${item.filename}: ${res.status}`);
      }

      // Write to disk immediately, then free the buffer
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(tmpPath, buffer);
      // buffer will be GC'd after this scope

      // Read metadata from file (no pixel decode)
      const meta = await sharp(tmpPath, { limitInputPixels: false }).metadata();

      const orderNum = item.order.shopifyOrderNumber || "";
      const customer = item.order.customerName || "";
      const label = [orderNum ? `#${orderNum}` : "", customer]
        .filter(Boolean)
        .join("  —  ");

      images.push({
        filePath: tmpPath,
        width: meta.width!,
        height: meta.height!,
        orderId: item.orderId,
        label,
      });
    }

    const canvasWidth = Math.min(
      Math.max(...images.map((img) => img.width)),
      MAX_WIDTH
    );

    // Count margins: add separator before each new order (including the first)
    let marginCount = 1;
    for (let i = 1; i < images.length; i++) {
      if (images[i].orderId !== images[i - 1].orderId) marginCount++;
    }
    const totalHeight =
      images.reduce((sum, img) => sum + img.height, 0) +
      marginCount * ORDER_MARGIN;

    console.log(
      `Combining ${images.length} images: ${canvasWidth}x${totalHeight}px (${(totalHeight / 300).toFixed(1)}in)`
    );

    // Build composites using FILE PATHS (not buffers).
    // libvips loads files from disk on demand during compositing,
    // so memory usage stays proportional to tile size, not total image size.
    const composites: sharp.OverlayOptions[] = [];
    let yOffset = 0;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const isNewOrder = i === 0 || img.orderId !== images[i - 1].orderId;

      if (isNewOrder) {
        // Write separator SVG to a temp file too
        const sepPath = path.join(tmpDir, `sep-${i}.png`);
        await sharp(orderSeparatorSvg(img.label, canvasWidth, ORDER_MARGIN))
          .png()
          .toFile(sepPath);

        composites.push({
          input: sepPath,
          top: yOffset,
          left: 0,
        });
        yOffset += ORDER_MARGIN;
      }

      composites.push({
        input: img.filePath,
        limitInputPixels: false,
        top: yOffset,
        left: 0,
      });

      yOffset += img.height;
    }

    // Write output to temp file (libvips processes in tiles, not all at once)
    const outputPath = path.join(tmpDir, "output.png");
    await sharp({
      create: {
        width: canvasWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
      limitInputPixels: false,
    })
      .composite(composites)
      .png({ compressionLevel: 6 })
      .toFile(outputPath);

    const filename = `${group.name.replace(/[^a-zA-Z0-9#]/g, "-")}.png`;
    const stat = await fs.stat(outputPath);

    // Stream the file to the client
    const nodeStream = createReadStream(outputPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    // Clean up temp files after stream ends
    nodeStream.on("close", () => {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(stat.size),
      },
    });
  } catch (e) {
    // Clean up on error
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.error("Download combine error:", e);
    const message =
      e instanceof Error ? e.message : "Failed to generate combined image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
