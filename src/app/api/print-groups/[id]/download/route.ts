import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";

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
 * Gang sheets can be very large (380MP+). To bypass sharp's 268MP
 * pixel limit, each image is pre-decoded to raw RGBA, and every
 * sharp() call + composite overlay uses limitInputPixels: false.
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
            select: { shopifyOrderNumber: true },
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

  // Pre-decode each image to raw RGBA pixels (bypasses pixel limit on composite)
  const images: {
    raw: Buffer;
    width: number;
    height: number;
    orderId: string;
    orderNumber: string;
  }[] = [];

  for (let i = 0; i < imageBuffers.length; i++) {
    const buf = imageBuffers[i];
    const { data, info } = await sharp(buf, { limitInputPixels: false })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    images.push({
      raw: data,
      width: info.width,
      height: info.height,
      orderId: group.items[i].orderId,
      orderNumber: group.items[i].order.shopifyOrderNumber || "",
    });
  }

  const canvasWidth = Math.min(
    Math.max(...images.map((img) => img.width)),
    MAX_WIDTH
  );

  // Count margins: add separator before each new order (including the first)
  let marginCount = 1; // first order gets a separator too
  for (let i = 1; i < images.length; i++) {
    if (images[i].orderId !== images[i - 1].orderId) marginCount++;
  }
  const totalHeight =
    images.reduce((sum, img) => sum + img.height, 0) +
    marginCount * ORDER_MARGIN;

  // Build composites with raw buffers + limitInputPixels on each overlay
  const composites: sharp.OverlayOptions[] = [];
  let yOffset = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const isNewOrder = i === 0 || img.orderId !== images[i - 1].orderId;

    // Insert separator with order number before each new order
    if (isNewOrder) {
      composites.push({
        input: orderSeparatorSvg(img.orderNumber, canvasWidth, ORDER_MARGIN),
        top: yOffset,
        left: 0,
      });
      yOffset += ORDER_MARGIN;
    }

    composites.push({
      input: img.raw,
      raw: { width: img.width, height: img.height, channels: 4 },
      limitInputPixels: false,
      top: yOffset,
      left: 0,
    });

    yOffset += img.height;
  }

  const combined = await sharp({
    create: {
      width: canvasWidth,
      height: totalHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
    limitInputPixels: false,
  })
    .composite(composites)
    .png()
    .toBuffer();

  const filename = `${group.name.replace(/[^a-zA-Z0-9#]/g, "-")}.png`;

  return new NextResponse(new Uint8Array(combined), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(combined.length),
    },
  });
}
