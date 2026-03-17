import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { streamUploadToR2 } from "@/lib/r2";
import {
  setDownloadProgress,
  getDownloadProgress,
  clearDownloadProgress,
  setAbortController,
} from "@/lib/download-progress";
import sharp from "sharp";

// Allow up to 5 minutes for large image processing
export const maxDuration = 300;

// Minimize sharp memory: disable cache, single thread
sharp.cache(false);
sharp.concurrency(1);

const OUTPUT_DPI = 75;
const MAX_WIDTH = 1650; // 22 inches at 75 DPI
const ORDER_MARGIN = 23; // separator height in px (scaled for 75 DPI)
const MAX_CHUNK_HEIGHT = 20000; // chunk limit at 75 DPI

function orderSeparatorSvg(
  text: string,
  canvasWidth: number,
  height: number,
  fontSize = 12
): Buffer {
  const lineY = height * 0.3;
  const textY = height * 0.85;
  const svg = `<svg width="${canvasWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${canvasWidth}" height="${height}" fill="none"/>
    <line x1="0" y1="${lineY}" x2="${canvasWidth}" y2="${lineY}" stroke="black" stroke-width="3" stroke-dasharray="20,12"/>
    <text x="20" y="${textY}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="black">${text}</text>
  </svg>`;
  return Buffer.from(svg);
}

type Piece = { filePath: string; width: number; height: number };

/** Delete source files for a list of pieces (best-effort). */
async function cleanupFiles(pieces: Piece[]): Promise<void> {
  for (const p of pieces) {
    await fs.unlink(p.filePath).catch(() => {});
  }
}

/** Check abort signal and throw if cancelled. */
function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Combine cancelled", "AbortError");
  }
}

/**
 * Generate a single combined PNG from a list of pieces.
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
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(compositeInputs)
    .withMetadata({ density: OUTPUT_DPI })
    .png({ compressionLevel: 1 })
    .toFile(outputPath);
}

/**
 * Split pieces into chunks that don't exceed MAX_CHUNK_HEIGHT.
 */
function splitIntoChunks(pieces: Piece[]): Piece[][] {
  const chunks: Piece[][] = [];
  let currentChunk: Piece[] = [];
  let currentHeight = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];

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
 * Helper to update DB progress (batched — only writes when change is significant)
 */
async function updateDbProgress(
  groupId: string,
  progress: number,
  phase: string
) {
  await prisma.printGroup.update({
    where: { id: groupId },
    data: { downloadProgress: progress },
  });
  // Also update in-memory for real-time polling
  setDownloadProgress(groupId, {
    progress,
    phase: phase as "downloading" | "generating" | "zipping" | "uploading",
  });
}

/**
 * POST /api/print-groups/:id/download
 *
 * Starts a background combine job. Returns immediately.
 * Progress is tracked in DB (downloadProgress, downloadStatus) and in-memory.
 */
export async function POST(
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

  // If already combined, return cached URL
  if (group.combinedFileUrl) {
    return NextResponse.json({ url: group.combinedFileUrl });
  }

  // Concurrency guard: check DB status
  if (group.downloadStatus === "PROCESSING") {
    return NextResponse.json(
      { error: "Download already in progress" },
      { status: 409 }
    );
  }

  // Also check in-memory progress
  if (getDownloadProgress(id)) {
    return NextResponse.json(
      { error: "Download already in progress" },
      { status: 409 }
    );
  }

  // Mark as PROCESSING in DB and return immediately
  await prisma.printGroup.update({
    where: { id },
    data: {
      downloadStatus: "PROCESSING",
      downloadProgress: 0,
      downloadError: null,
      downloadStartedAt: new Date(),
    },
  });

  const totalImages = group.items.length;
  setDownloadProgress(id, {
    progress: 0,
    phase: "downloading",
    totalImages,
    currentImage: 0,
  });

  // Create AbortController for cancellation support
  const abortController = new AbortController();
  setAbortController(id, abortController);

  // Fire-and-forget: run the actual combine work in a detached promise
  runCombineJob(id, group, abortController.signal).catch((e) => {
    console.error(`Background combine failed for group ${id}:`, e);
  });

  return NextResponse.json({ status: "started" });
}

/**
 * Background combine job — runs detached from the HTTP request.
 */
async function runCombineJob(
  groupId: string,
  group: {
    name: string;
    items: Array<{
      orderId: string;
      fileUrl: string;
      filename: string;
      order: {
        shopifyOrderNumber: string | null;
        customerName: string | null;
      };
    }>;
  },
  signal: AbortSignal
) {
  const totalImages = group.items.length;

  // Use persistent disk if available (COMBINE_TMP_DIR=/data/tmp), fallback to OS /tmp
  const tmpBase = process.env.COMBINE_TMP_DIR || os.tmpdir();
  await fs.mkdir(tmpBase, { recursive: true }).catch(() => {});

  // Clean up stale combine dirs from previous crashed jobs
  try {
    const entries = await fs.readdir(tmpBase);
    for (const entry of entries) {
      if (entry.startsWith("combine-")) {
        const full = path.join(tmpBase, entry);
        const stat = await fs.stat(full).catch(() => null);
        // Remove dirs older than 10 minutes
        if (stat?.isDirectory() && Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
          await fs.rm(full, { recursive: true, force: true }).catch(() => {});
          console.log(`Cleaned stale tmp dir: ${entry}`);
        }
      }
    }
  } catch { /* ignore cleanup errors */ }

  const tmpDir = await fs.mkdtemp(path.join(tmpBase, "combine-"));
  let lastDbUpdate = 0; // track last DB update to batch writes

  try {
    checkAborted(signal);

    // Step 1: Download all images and collect metadata
    const pieces: Piece[] = [];

    for (let i = 0; i < group.items.length; i++) {
      checkAborted(signal);

      const item = group.items[i];
      const imgPath = path.join(tmpDir, `img-${i}.png`);

      // Download to disk
      const res = await fetch(item.fileUrl, { signal });
      if (!res.ok) {
        throw new Error(`Failed to fetch ${item.filename}: ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const rawPath = path.join(tmpDir, `raw-${i}.png`);
      await fs.writeFile(rawPath, buffer);

      const meta = await sharp(rawPath, { limitInputPixels: false }).metadata();
      const srcDpi = meta.density || 300;
      const scale = OUTPUT_DPI / srcDpi;
      const newWidth = Math.round(meta.width! * scale);
      const newHeight = Math.round(meta.height! * scale);

      // Resize to 75 DPI
      await sharp(rawPath, { limitInputPixels: false })
        .resize(newWidth, newHeight)
        .withMetadata({ density: OUTPUT_DPI })
        .png()
        .toFile(imgPath);
      await fs.unlink(rawPath).catch(() => {});

      // If this is the start of a new order, add a separator
      const isNewOrder =
        i === 0 || item.orderId !== group.items[i - 1].orderId;

      if (isNewOrder) {
        const orderNum = item.order.shopifyOrderNumber || "";
        const customer = item.order.customerName || "";
        const label = [orderNum ? `#${orderNum}` : "", customer]
          .filter(Boolean)
          .join("  —  ");

        const sepWidth = Math.min(newWidth, MAX_WIDTH);
        const sepPath = path.join(tmpDir, `sep-${i}.png`);
        await sharp(orderSeparatorSvg(label, sepWidth, ORDER_MARGIN))
          .png()
          .toFile(sepPath);

        pieces.push({ filePath: sepPath, width: sepWidth, height: ORDER_MARGIN });
      }

      pieces.push({ filePath: imgPath, width: newWidth, height: newHeight });

      const progress = Math.round(((i + 1) / totalImages) * 60);

      // Update in-memory progress always
      setDownloadProgress(groupId, {
        progress,
        phase: "downloading",
        totalImages,
        currentImage: i + 1,
      });

      // Update DB every 2 images or on last image
      if (i - lastDbUpdate >= 2 || i === group.items.length - 1) {
        await prisma.printGroup.update({
          where: { id: groupId },
          data: { downloadProgress: progress },
        });
        lastDbUpdate = i;
      }
    }

    const canvasWidth = Math.max(...pieces.map((p) => p.width));
    const totalHeight = pieces.reduce((sum, p) => sum + p.height, 0);
    console.log(`Total: ${pieces.length} pieces, ${canvasWidth}x${totalHeight}px`);

    // Step 2: Split into chunks if needed
    const chunks = splitIntoChunks(pieces);
    console.log(`Split into ${chunks.length} chunk(s)`);

    checkAborted(signal);
    await updateDbProgress(groupId, 60, "generating");

    const baseName = group.name.replace(/[^a-zA-Z0-9]/g, "-");

    if (chunks.length === 1) {
      // Single chunk
      const outputPath = path.join(tmpDir, "output.png");

      setDownloadProgress(groupId, {
        progress: 65,
        phase: "generating",
        totalChunks: 1,
        currentChunk: 1,
      });

      await generateChunkPng(chunks[0], outputPath, canvasWidth);
      checkAborted(signal);

      // Free source images immediately — only keep the output
      await cleanupFiles(chunks[0]);

      const stat = await fs.stat(outputPath);
      console.log(`Output: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);

      await updateDbProgress(groupId, 90, "uploading");
      checkAborted(signal);

      const r2Key = `combined/${Date.now()}-${baseName}.png`;
      const uploadStream = createReadStream(outputPath);
      const r2Url = await streamUploadToR2(uploadStream, r2Key, "image/png", stat.size);

      // Mark complete
      await prisma.printGroup.update({
        where: { id: groupId },
        data: {
          combinedFileUrl: r2Url,
          downloadStatus: null,
          downloadProgress: 0,
          downloadError: null,
        },
      });
    } else {
      // Multiple chunks — generate PNGs then ZIP
      const chunkPaths: string[] = [];

      for (let c = 0; c < chunks.length; c++) {
        checkAborted(signal);

        const chunkPath = path.join(tmpDir, `${baseName}-part${c + 1}.png`);
        const chunkHeight = chunks[c].reduce((sum, p) => sum + p.height, 0);
        console.log(`Generating chunk ${c + 1}/${chunks.length}: ${canvasWidth}x${chunkHeight}px`);

        const progress = 60 + Math.round(((c + 1) / chunks.length) * 25);
        setDownloadProgress(groupId, {
          progress,
          phase: "generating",
          totalChunks: chunks.length,
          currentChunk: c + 1,
        });
        await prisma.printGroup.update({
          where: { id: groupId },
          data: { downloadProgress: progress },
        });

        await generateChunkPng(chunks[c], chunkPath, canvasWidth);

        // Free source images for this chunk immediately
        await cleanupFiles(chunks[c]);

        const stat = await fs.stat(chunkPath);
        console.log(`Chunk ${c + 1}: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
        chunkPaths.push(chunkPath);
      }

      checkAborted(signal);

      // Create ZIP
      await updateDbProgress(groupId, 86, "zipping");

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

      checkAborted(signal);

      // Free chunk PNGs now that they're in the ZIP
      for (const cp of chunkPaths) {
        await fs.unlink(cp).catch(() => {});
      }

      const zipStat = await fs.stat(zipPath);
      console.log(`ZIP: ${(zipStat.size / 1024 / 1024).toFixed(1)}MB`);

      await updateDbProgress(groupId, 90, "uploading");

      const r2Key = `combined/${Date.now()}-${baseName}.zip`;
      const uploadStream = createReadStream(zipPath);
      const r2Url = await streamUploadToR2(uploadStream, r2Key, "application/zip", zipStat.size);

      // Mark complete
      await prisma.printGroup.update({
        where: { id: groupId },
        data: {
          combinedFileUrl: r2Url,
          downloadStatus: null,
          downloadProgress: 0,
          downloadError: null,
        },
      });
    }

    clearDownloadProgress(groupId);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    console.log(`Background combine completed for group ${groupId}`);
  } catch (e) {
    clearDownloadProgress(groupId);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    const isCancelled = e instanceof DOMException && e.name === "AbortError";

    if (isCancelled) {
      console.log(`Combine cancelled for group ${groupId}`);
      // DB is already reset by the cancel endpoint
      return;
    }

    const message = e instanceof Error ? e.message : "Failed to generate combined image";
    console.error(`Background combine error for group ${groupId}:`, message);

    // Mark as failed in DB
    await prisma.printGroup.update({
      where: { id: groupId },
      data: {
        downloadStatus: "FAILED",
        downloadProgress: 0,
        downloadError: message,
      },
    });
  }
}
