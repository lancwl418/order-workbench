import { NextRequest, NextResponse } from "next/server";
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
 * Memory-optimised: uses compressed PNG buffers in composite (not raw RGBA)
 * and streams the output, so libvips can process large images (~380MP+)
 * without holding everything in memory at once.
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

  try {
    // Fetch all images in parallel
    const imageBuffers = await Promise.all(
      group.items.map(async (item) => {
        const res = await fetch(item.fileUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${item.filename}: ${res.status}`);
        }
        return Buffer.from(await res.arrayBuffer());
      })
    );

    // Read dimensions from metadata only (no full pixel decode – saves memory)
    const images: {
      buf: Buffer;
      width: number;
      height: number;
      orderId: string;
      label: string;
    }[] = [];

    for (let i = 0; i < imageBuffers.length; i++) {
      const buf = imageBuffers[i];
      const meta = await sharp(buf, { limitInputPixels: false }).metadata();
      const item = group.items[i];
      const orderNum = item.order.shopifyOrderNumber || "";
      const customer = item.order.customerName || "";
      const label = [orderNum ? `#${orderNum}` : "", customer]
        .filter(Boolean)
        .join("  —  ");

      images.push({
        buf,
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

    console.log(`Combining ${images.length} images: ${canvasWidth}x${totalHeight}px`);

    // Build composites using compressed PNG buffers (not raw RGBA).
    // libvips decodes them on-demand during compositing, using far less memory.
    const composites: sharp.OverlayOptions[] = [];
    let yOffset = 0;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const isNewOrder = i === 0 || img.orderId !== images[i - 1].orderId;

      if (isNewOrder) {
        composites.push({
          input: orderSeparatorSvg(img.label, canvasWidth, ORDER_MARGIN),
          top: yOffset,
          left: 0,
        });
        yOffset += ORDER_MARGIN;
      }

      composites.push({
        input: img.buf,
        limitInputPixels: false,
        top: yOffset,
        left: 0,
      });

      yOffset += img.height;
    }

    // Stream the output instead of buffering the full PNG in memory
    const pipeline = sharp({
      create: {
        width: canvasWidth,
        height: totalHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
      limitInputPixels: false,
    })
      .composite(composites)
      .png();

    const filename = `${group.name.replace(/[^a-zA-Z0-9#]/g, "-")}.png`;

    // Convert Node.js readable stream to Web ReadableStream
    const nodeStream = pipeline as unknown as Readable;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (e) {
    console.error("Download combine error:", e);
    const message = e instanceof Error ? e.message : "Failed to generate combined image";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
