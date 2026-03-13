import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";

const MAX_WIDTH = 6600; // 22 inches at 300 DPI

function orderLabelSvg(text: string, fontSize = 48): Buffer {
  const padding = 10;
  const width = text.length * fontSize * 0.65 + padding * 2;
  const height = fontSize + padding * 2;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="white" fill-opacity="0.85"/>
    <text x="${padding}" y="${fontSize + padding / 2}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="black">${text}</text>
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
      orderNumber: group.items[i].order.shopifyOrderNumber || "",
    });
  }

  const canvasWidth = Math.min(
    Math.max(...images.map((img) => img.width)),
    MAX_WIDTH
  );
  const totalHeight = images.reduce((sum, img) => sum + img.height, 0);

  // Build composites with raw buffers + limitInputPixels on each overlay
  const composites: sharp.OverlayOptions[] = [];
  let yOffset = 0;

  for (const img of images) {
    composites.push({
      input: img.raw,
      raw: { width: img.width, height: img.height, channels: 4 },
      limitInputPixels: false,
      top: yOffset,
      left: 0,
    });

    if (img.orderNumber) {
      composites.push({
        input: orderLabelSvg(img.orderNumber),
        top: yOffset + 20,
        left: 20,
      });
    }

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

  return new NextResponse(combined, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(combined.length),
    },
  });
}
