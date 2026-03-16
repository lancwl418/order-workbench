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

// Minimize sharp memory: disable cache, single thread
sharp.cache(false);
sharp.concurrency(1);

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
 * Uses a single-pass composite: pre-calculates all y-offsets then
 * composites everything in one sharp call. libvips processes in tiles
 * so peak memory stays low regardless of total image height.
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
    // Step 1: Download all images and collect metadata
    const pieces: { filePath: string; width: number; height: number }[] = [];

    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const imgPath = path.join(tmpDir, `img-${i}.png`);

      // Download to disk
      const res = await fetch(item.fileUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${item.filename}: ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(imgPath, buffer);

      const meta = await sharp(imgPath, { limitInputPixels: false }).metadata();

      // If this is the start of a new order, add a separator
      const isNewOrder =
        i === 0 || item.orderId !== group.items[i - 1].orderId;

      if (isNewOrder) {
        const orderNum = item.order.shopifyOrderNumber || "";
        const customer = item.order.customerName || "";
        const label = [orderNum ? `#${orderNum}` : "", customer]
          .filter(Boolean)
          .join("  —  ");

        const canvasWidth = Math.min(meta.width!, MAX_WIDTH);
        const sepPath = path.join(tmpDir, `sep-${i}.png`);
        await sharp(orderSeparatorSvg(label, canvasWidth, ORDER_MARGIN))
          .png()
          .toFile(sepPath);

        pieces.push({ filePath: sepPath, width: canvasWidth, height: ORDER_MARGIN });
      }

      pieces.push({ filePath: imgPath, width: meta.width!, height: meta.height! });
    }

    // Step 2: Calculate canvas dimensions and y-offsets
    const canvasWidth = Math.max(...pieces.map((p) => p.width));
    let totalHeight = 0;
    const compositeInputs: sharp.OverlayOptions[] = [];

    for (const piece of pieces) {
      compositeInputs.push({
        input: piece.filePath,
        limitInputPixels: false,
        top: totalHeight,
        left: 0,
      });
      totalHeight += piece.height;
    }

    console.log(
      `Compositing ${pieces.length} pieces → ${canvasWidth}x${totalHeight}px`
    );

    // Step 3: Single-pass composite — libvips tiles through the output
    const outputPath = path.join(tmpDir, "output.png");
    await sharp({
      create: {
        width: canvasWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(compositeInputs)
      .png({ compressionLevel: 1 })
      .toFile(outputPath);

    // Verify
    const outputMeta = await sharp(outputPath, { limitInputPixels: false }).metadata();
    console.log(
      `Output: ${outputMeta.width}x${outputMeta.height}px, format: ${outputMeta.format}`
    );

    const filename = `${group.name.replace(/[^a-zA-Z0-9#]/g, "-")}.png`;
    const stat = await fs.stat(outputPath);

    console.log(`Output file size: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

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
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.error("Download combine error:", e);
    const message =
      e instanceof Error ? e.message : "Failed to generate combined image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
