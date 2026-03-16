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
 * Vertically join images two at a time using a binary-tree reduction.
 * At any step, only two images are decoded, keeping peak memory low.
 * All intermediates are written to disk.
 */
async function joinVertically(
  filePaths: string[],
  tmpDir: string
): Promise<string> {
  if (filePaths.length === 1) return filePaths[0];

  let current = [...filePaths];
  let round = 0;

  while (current.length > 1) {
    const next: string[] = [];

    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 >= current.length) {
        // Odd one out — carry forward
        next.push(current[i]);
        continue;
      }

      const outPath = path.join(tmpDir, `join-${round}-${i}.png`);

      // Get dimensions of both images
      const metaA = await sharp(current[i], { limitInputPixels: false }).metadata();
      const metaB = await sharp(current[i + 1], { limitInputPixels: false }).metadata();

      const width = Math.max(metaA.width!, metaB.width!);
      const totalH = metaA.height! + metaB.height!;

      // Extend image A downward, then composite B below
      await sharp(current[i], { limitInputPixels: false })
        .extend({
          bottom: metaB.height!,
          right: Math.max(0, width - metaA.width!),
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .composite([
          {
            input: current[i + 1],
            limitInputPixels: false,
            top: metaA.height!,
            left: 0,
          },
        ])
        .png({ compressionLevel: 1 }) // Fast compression for intermediates
        .toFile(outPath);

      next.push(outPath);

      // Delete intermediates from previous rounds to save disk space
      if (round > 0) {
        await fs.unlink(current[i]).catch(() => {});
        await fs.unlink(current[i + 1]).catch(() => {});
      }
    }

    current = next;
    round++;
  }

  return current[0];
}

/**
 * GET /api/print-groups/:id/download
 *
 * Fetches all gang sheet PNGs in the group, stitches them vertically
 * into one combined image, and returns it as a PNG download.
 *
 * Memory-optimised: uses binary-tree join (two images at a time)
 * with all intermediates on disk. Peak memory is proportional to
 * the two largest images being joined, not the total combined size.
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
    // Step 1: Download images one at a time and prepare strips
    // Each "strip" = separator PNG + image PNG, joined vertically
    const stripPaths: string[] = [];

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

      // Determine if this is the start of a new order
      const isNewOrder =
        i === 0 ||
        item.orderId !== group.items[i - 1].orderId;

      if (isNewOrder) {
        const orderNum = item.order.shopifyOrderNumber || "";
        const customer = item.order.customerName || "";
        const label = [orderNum ? `#${orderNum}` : "", customer]
          .filter(Boolean)
          .join("  —  ");

        // Create separator + image as one strip
        const canvasWidth = Math.min(meta.width!, MAX_WIDTH);
        const sepPath = path.join(tmpDir, `sep-${i}.png`);
        await sharp(orderSeparatorSvg(label, canvasWidth, ORDER_MARGIN))
          .png()
          .toFile(sepPath);

        // Join separator + image into one strip
        const stripPath = path.join(tmpDir, `strip-${i}.png`);
        await sharp(sepPath, { limitInputPixels: false })
          .extend({
            bottom: meta.height!,
            right: Math.max(0, canvasWidth - (await sharp(sepPath).metadata()).width!),
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .composite([
            {
              input: imgPath,
              limitInputPixels: false,
              top: ORDER_MARGIN,
              left: 0,
            },
          ])
          .png({ compressionLevel: 1 })
          .toFile(stripPath);

        stripPaths.push(stripPath);
      } else {
        // No separator needed, just use the image directly
        stripPaths.push(imgPath);
      }
    }

    console.log(`Joining ${stripPaths.length} strips via binary-tree reduction`);

    // Step 2: Binary-tree join — only two images in memory at a time
    const finalPath = await joinVertically(stripPaths, tmpDir);

    // Step 3: Re-compress final output as optimized PNG
    const outputPath = path.join(tmpDir, "output.png");
    await sharp(finalPath, { limitInputPixels: false })
      .png({ compressionLevel: 6 })
      .toFile(outputPath);

    // Verify the output is valid
    const outputMeta = await sharp(outputPath, { limitInputPixels: false }).metadata();
    console.log(`Output: ${outputMeta.width}x${outputMeta.height}px, format: ${outputMeta.format}`);

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
