import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { streamUploadToR2 } from "@/lib/r2";
import sharp from "sharp";

// Allow up to 5 minutes for large image processing
export const maxDuration = 300;

// Minimize sharp memory: disable cache, single thread
sharp.cache(false);
sharp.concurrency(1);

const MAX_WIDTH = 6600; // 22 inches at 300 DPI
const ORDER_MARGIN = 90; // separator height in px
const MAX_CHUNK_HEIGHT = 80000; // ~10m per chunk at common DPIs

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

type Piece = { filePath: string; width: number; height: number };

/**
 * Generate a single combined PNG from a list of pieces.
 * All pieces must fit within memory constraints.
 */
async function generateChunkPng(
  pieces: Piece[],
  outputPath: string,
  canvasWidth: number
): Promise<void> {
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

  await sharp({
    limitInputPixels: false,
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
}

/**
 * Split pieces into chunks that don't exceed MAX_CHUNK_HEIGHT.
 * Tries to split at order boundaries (separator pieces).
 */
function splitIntoChunks(pieces: Piece[]): Piece[][] {
  const chunks: Piece[][] = [];
  let currentChunk: Piece[] = [];
  let currentHeight = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];

    // If adding this piece exceeds max height and chunk isn't empty,
    // start a new chunk
    if (currentHeight + piece.height > MAX_CHUNK_HEIGHT && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentHeight = 0;
    }

    currentChunk.push(piece);
    currentHeight += piece.height;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * GET /api/print-groups/:id/download
 *
 * Fetches all gang sheet PNGs in the group, stitches them vertically
 * into combined image(s), uploads to R2, and returns the download URL(s).
 *
 * For large groups, splits into multiple chunks to stay within memory.
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

  // If already combined and uploaded, redirect to cached URL
  if (group.combinedFileUrl) {
    return NextResponse.redirect(group.combinedFileUrl);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "combine-"));

  try {
    // Step 1: Download all images and collect metadata
    const pieces: Piece[] = [];

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

    const canvasWidth = Math.max(...pieces.map((p) => p.width));
    const totalHeight = pieces.reduce((sum, p) => sum + p.height, 0);
    console.log(`Total: ${pieces.length} pieces, ${canvasWidth}x${totalHeight}px`);

    // Step 2: Split into chunks if needed
    const chunks = splitIntoChunks(pieces);
    console.log(`Split into ${chunks.length} chunk(s)`);

    const baseName = group.name.replace(/[^a-zA-Z0-9]/g, "-");

    if (chunks.length === 1) {
      // Single chunk — generate one file
      const outputPath = path.join(tmpDir, "output.png");
      await generateChunkPng(chunks[0], outputPath, canvasWidth);

      const stat = await fs.stat(outputPath);
      console.log(`Output: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

      // Upload to R2
      const r2Key = `combined/${Date.now()}-${baseName}.png`;
      const uploadStream = createReadStream(outputPath);
      const r2Url = await streamUploadToR2(uploadStream, r2Key, "image/png", stat.size);

      await prisma.printGroup.update({
        where: { id },
        data: { combinedFileUrl: r2Url },
      });

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return NextResponse.redirect(r2Url);
    } else {
      // Multiple chunks — generate each PNG, then ZIP them together
      const chunkPaths: string[] = [];

      for (let c = 0; c < chunks.length; c++) {
        const chunkPath = path.join(tmpDir, `${baseName}-part${c + 1}.png`);
        const chunkHeight = chunks[c].reduce((sum, p) => sum + p.height, 0);
        console.log(`Generating chunk ${c + 1}/${chunks.length}: ${canvasWidth}x${chunkHeight}px`);

        await generateChunkPng(chunks[c], chunkPath, canvasWidth);

        const stat = await fs.stat(chunkPath);
        console.log(`Chunk ${c + 1}: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
        chunkPaths.push(chunkPath);
      }

      // Create ZIP archive
      const zipPath = path.join(tmpDir, `${baseName}.zip`);
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 1 } });
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        for (const cp of chunkPaths) {
          archive.file(cp, { name: path.basename(cp) });
        }
        archive.finalize();
      });

      const zipStat = await fs.stat(zipPath);
      console.log(`ZIP: ${(zipStat.size / 1024 / 1024).toFixed(1)}MB`);

      const r2Key = `combined/${Date.now()}-${baseName}.zip`;
      const uploadStream = createReadStream(zipPath);
      const r2Url = await streamUploadToR2(uploadStream, r2Key, "application/zip", zipStat.size);

      await prisma.printGroup.update({
        where: { id },
        data: { combinedFileUrl: r2Url },
      });

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return NextResponse.redirect(r2Url);
    }
  } catch (e) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.error("Download combine error:", e);
    const message =
      e instanceof Error ? e.message : "Failed to generate combined image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
