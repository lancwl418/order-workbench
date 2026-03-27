import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveGangSheetUrls,
  isDirectImageUrl,
  type ResolvedPrintFile,
} from "@/lib/drip/resolve-gang-sheet";
import { getPngDimensions } from "@/lib/drip/png-dimensions";
import { refreshPrintFileUrls } from "@/lib/shopify/refresh-print-urls";
import { z } from "zod";

const MAX_GROUP_HEIGHT = 3897; // inches

const addOrderSchema = z.object({
  orderId: z.string(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = addOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderId } = parsed.data;

  // Refresh URLs from Shopify before adding (catches gangsheet updates)
  await refreshPrintFileUrls(orderId);

  // Load order with items
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      printGroupItems: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Don't add if already in an active (BUILDING) group
  const activeGroupItem = await prisma.printGroupItem.findFirst({
    where: {
      orderId,
      printGroup: { status: "BUILDING" },
    },
  });
  if (activeGroupItem) {
    return NextResponse.json(
      { error: "Order is already in an active print group" },
      { status: 400 }
    );
  }

  // Resolve print files from order items
  const urlSet = new Set<string>();
  const urlLabelMap = new Map<string, string>();
  for (const item of order.orderItems) {
    if (item.designFileUrl && !urlSet.has(item.designFileUrl)) {
      urlSet.add(item.designFileUrl);
      urlLabelMap.set(
        item.designFileUrl,
        item.variantTitle || item.title
      );
    }
  }

  // Also include extra print files
  const extras = Array.isArray(order.extraPrintFiles)
    ? (order.extraPrintFiles as { url: string; filename: string }[])
    : [];
  for (const extra of extras) {
    if (!urlSet.has(extra.url)) {
      urlSet.add(extra.url);
      urlLabelMap.set(extra.url, extra.filename);
    }
  }

  if (urlSet.size === 0) {
    return NextResponse.json(
      { error: "Order has no print files" },
      { status: 400 }
    );
  }

  // Resolve all files (direct URLs or Transfer by Size pages)
  const resolvedFiles: ResolvedPrintFile[] = [];
  for (const url of urlSet) {
    if (isDirectImageUrl(url)) {
      const label = urlLabelMap.get(url) || "print-file";
      const orderNum = order.shopifyOrderNumber?.replace("#", "") || "";
      resolvedFiles.push({ url, filename: `${orderNum}-${label}.png` });
    } else {
      const resolved = await resolveGangSheetUrls(url);
      resolvedFiles.push(...resolved);
    }
  }

  if (resolvedFiles.length === 0) {
    return NextResponse.json(
      { error: "Could not resolve any print files" },
      { status: 400 }
    );
  }

  // Fetch dimensions for each file
  const filesWithDimensions = await Promise.all(
    resolvedFiles.map(async (file) => {
      try {
        const dims = await getPngDimensions(file.url);
        return { ...file, ...dims };
      } catch (e) {
        console.error(`Failed to get dimensions for ${file.url}:`, e);
        return null;
      }
    })
  );

  const validFiles = filesWithDimensions.filter(
    (f): f is NonNullable<typeof f> => f !== null
  );

  if (validFiles.length === 0) {
    return NextResponse.json(
      { error: "Could not read dimensions from any print files" },
      { status: 500 }
    );
  }

  const orderHeight = validFiles.reduce((sum, f) => sum + f.heightInches, 0);

  // Find or create BUILDING group
  let group = await prisma.printGroup.findFirst({
    where: { status: "BUILDING" },
    include: { items: { select: { position: true } } },
  });

  // Auto-combine if adding this order would exceed max height
  if (group && group.totalHeight + orderHeight > MAX_GROUP_HEIGHT) {
    await prisma.printGroup.update({
      where: { id: group.id },
      data: { status: "READY" },
    });
    group = null; // Will create a new one below
  }

  if (!group) {
    // Generate name: "Group #N" — resets to 1 each day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await prisma.printGroup.count({
      where: { createdAt: { gte: todayStart } },
    });
    group = await prisma.printGroup.create({
      data: {
        name: `Group #${todayCount + 1}`,
        status: "BUILDING",
        totalHeight: 0,
      },
      include: { items: { select: { position: true } } },
    });
  }

  // Determine next position
  const maxPosition = group.items.reduce(
    (max, item) => Math.max(max, item.position),
    0
  );

  // Create PrintGroupItems
  const itemsData = validFiles.map((file, i) => ({
    printGroupId: group!.id,
    orderId,
    position: maxPosition + i + 1,
    fileUrl: file.url,
    filename: file.filename,
    widthPx: file.widthPx,
    heightPx: file.heightPx,
    dpi: file.dpi,
    heightInches: file.heightInches,
  }));

  await prisma.printGroupItem.createMany({ data: itemsData });

  // Update group total height
  await prisma.printGroup.update({
    where: { id: group.id },
    data: { totalHeight: group.totalHeight + orderHeight },
  });

  // Update print status to IN_QUEUE
  if (order.printStatus !== "IN_QUEUE") {
    await prisma.order.update({
      where: { id: orderId },
      data: { printStatus: "IN_QUEUE" },
    });

    await prisma.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "print_status_change",
        fromValue: order.printStatus,
        toValue: "IN_QUEUE",
        message: `Added to print group: ${group.name}`,
      },
    });
  }

  // Return updated group with items
  const updatedGroup = await prisma.printGroup.findUnique({
    where: { id: group.id },
    include: {
      items: {
        include: {
          order: {
            select: {
              id: true,
              shopifyOrderNumber: true,
              customerName: true,
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  return NextResponse.json(updatedGroup);
}
