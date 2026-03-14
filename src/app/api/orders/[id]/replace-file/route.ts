import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveGangSheetUrls,
  isDirectImageUrl,
  type ResolvedPrintFile,
} from "@/lib/drip/resolve-gang-sheet";
import { getPngDimensions } from "@/lib/drip/png-dimensions";
import { z } from "zod";

const replaceSchema = z.object({
  sourceUrl: z.string().min(1),
  newUrl: z.string().min(1),
});

/**
 * POST /api/orders/:id/replace-file
 *
 * Replaces the designFileUrl on all OrderItems sharing the given sourceUrl.
 * Preserves the original URL on first replacement.
 * Cascades to any BUILDING print group.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const body = await req.json();
  const parsed = replaceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { sourceUrl, newUrl } = parsed.data;

  // Find all OrderItems on this order with the given designFileUrl
  const items = await prisma.orderItem.findMany({
    where: { orderId, designFileUrl: sourceUrl },
  });

  if (items.length === 0) {
    return NextResponse.json(
      { error: "No matching items found" },
      { status: 404 }
    );
  }

  // Check none are already printed
  if (items.some((i) => i.isPrinted)) {
    return NextResponse.json(
      { error: "Cannot replace file on printed items" },
      { status: 400 }
    );
  }

  // Update all matching items, preserving original on first replacement
  for (const item of items) {
    const originalFields =
      !item.originalDesignFileUrl && item.designFileUrl
        ? { originalDesignFileUrl: item.designFileUrl }
        : {};

    await prisma.orderItem.update({
      where: { id: item.id },
      data: { designFileUrl: newUrl, ...originalFields },
    });
  }

  // If the order had no print files before, set printStatus to READY
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { shopifyOrderNumber: true, printStatus: true },
  });
  if (order?.printStatus === "NONE") {
    await prisma.order.update({
      where: { id: orderId },
      data: { printStatus: "READY" },
    });
  }

  // Log the change
  await prisma.orderLog.create({
    data: {
      orderId,
      userId: session.user?.id,
      action: "file_replaced",
      fromValue: sourceUrl,
      toValue: newUrl,
      message: `Print file replaced (${items.length} item${items.length > 1 ? "s" : ""})`,
    },
  });

  // Cascade to BUILDING print group if applicable
  const buildingGroupItem = await prisma.printGroupItem.findFirst({
    where: {
      orderId,
      printGroup: { status: "BUILDING" },
    },
    include: { printGroup: true },
  });

  if (buildingGroupItem) {
    const groupId = buildingGroupItem.printGroupId;

    // Calculate old height contribution
    const oldGroupItems = await prisma.printGroupItem.findMany({
      where: { printGroupId: groupId, orderId },
    });
    const oldHeight = oldGroupItems.reduce(
      (sum, i) => sum + i.heightInches,
      0
    );

    // Delete old PrintGroupItems for this order
    await prisma.printGroupItem.deleteMany({
      where: { printGroupId: groupId, orderId },
    });

    // Re-collect unique designFileUrls from all order items (after update)
    const allOrderItems = await prisma.orderItem.findMany({
      where: { orderId },
    });

    const urlSet = new Set<string>();
    const urlLabelMap = new Map<string, string>();
    for (const oi of allOrderItems) {
      if (oi.designFileUrl && !urlSet.has(oi.designFileUrl)) {
        urlSet.add(oi.designFileUrl);
        urlLabelMap.set(oi.designFileUrl, oi.variantTitle || oi.title);
      }
    }

    if (urlSet.size > 0) {
      const resolvedFiles: ResolvedPrintFile[] = [];
      for (const url of urlSet) {
        if (isDirectImageUrl(url)) {
          const label = urlLabelMap.get(url) || "print-file";
          const orderNum =
            order?.shopifyOrderNumber?.replace("#", "") || "";
          resolvedFiles.push({ url, filename: `${orderNum}-${label}.png` });
        } else {
          const resolved = await resolveGangSheetUrls(url);
          resolvedFiles.push(...resolved);
        }
      }

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

      if (validFiles.length > 0) {
        const remaining = await prisma.printGroupItem.findMany({
          where: { printGroupId: groupId },
          select: { position: true },
        });
        const maxPosition = remaining.reduce(
          (max, r) => Math.max(max, r.position),
          0
        );

        const newItems = validFiles.map((file, i) => ({
          printGroupId: groupId,
          orderId,
          position: maxPosition + i + 1,
          fileUrl: file.url,
          filename: file.filename,
          widthPx: file.widthPx,
          heightPx: file.heightPx,
          dpi: file.dpi,
          heightInches: file.heightInches,
        }));

        await prisma.printGroupItem.createMany({ data: newItems });

        const newHeight = validFiles.reduce(
          (sum, f) => sum + f.heightInches,
          0
        );

        const group = await prisma.printGroup.findUnique({
          where: { id: groupId },
        });
        if (group) {
          await prisma.printGroup.update({
            where: { id: groupId },
            data: { totalHeight: group.totalHeight - oldHeight + newHeight },
          });
        }
      }
    }
  }

  return NextResponse.json({ success: true, itemsUpdated: items.length });
}
