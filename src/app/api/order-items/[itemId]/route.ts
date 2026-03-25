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

const updateSchema = z.object({
  designFileUrl: z.string().min(1, "URL is required"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { designFileUrl } = parsed.data;

  // Load the item
  const item = await prisma.orderItem.findUnique({
    where: { id: itemId },
    include: { order: { select: { id: true, shopifyOrderNumber: true } } },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.isPrinted) {
    return NextResponse.json(
      { error: "Cannot replace file on a printed item" },
      { status: 400 }
    );
  }

  const oldUrl = item.designFileUrl;

  // Preserve original URL on first replacement
  const originalFields = !item.originalDesignFileUrl && oldUrl
    ? { originalDesignFileUrl: oldUrl }
    : {};

  // Update the OrderItem
  const updated = await prisma.orderItem.update({
    where: { id: itemId },
    data: { designFileUrl, ...originalFields },
  });

  // If the order had no print files before, set printStatus to READY
  const order = await prisma.order.findUnique({
    where: { id: item.orderId },
    select: { printStatus: true, shopifyOrderNumber: true },
  });
  if (order?.printStatus === "NONE") {
    await prisma.order.update({
      where: { id: item.orderId },
      data: { printStatus: "READY" },
    });
  }

  // Log the change
  await prisma.orderLog.create({
    data: {
      orderId: item.orderId,
      userId: session.user?.id,
      action: "file_replaced",
      fromValue: oldUrl || "",
      toValue: designFileUrl,
      message: `Print file replaced on item "${item.title}"`,
    },
  });

  // Cascade to BUILDING print group if applicable
  const buildingGroupItem = await prisma.printGroupItem.findFirst({
    where: {
      orderId: item.orderId,
      printGroup: { status: "BUILDING" },
    },
    include: { printGroup: true },
  });

  if (buildingGroupItem) {
    const groupId = buildingGroupItem.printGroupId;

    // Calculate old height contribution from this order
    const oldItems = await prisma.printGroupItem.findMany({
      where: { printGroupId: groupId, orderId: item.orderId },
    });
    const oldHeight = oldItems.reduce((sum, i) => sum + i.heightInches, 0);

    // Delete old PrintGroupItems for this order
    await prisma.printGroupItem.deleteMany({
      where: { printGroupId: groupId, orderId: item.orderId },
    });

    // Re-collect unique designFileUrls from all of this order's items
    const allOrderItems = await prisma.orderItem.findMany({
      where: { orderId: item.orderId },
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
      // Resolve all files
      const resolvedFiles: ResolvedPrintFile[] = [];
      for (const url of urlSet) {
        if (isDirectImageUrl(url)) {
          const label = urlLabelMap.get(url) || "print-file";
          const orderNum =
            item.order.shopifyOrderNumber?.replace("#", "") || "";
          resolvedFiles.push({ url, filename: `${orderNum}-${label}.png` });
        } else {
          const resolved = await resolveGangSheetUrls(url);
          resolvedFiles.push(...resolved);
        }
      }

      // Fetch dimensions
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
        // Find max position among remaining items in the group
        const remaining = await prisma.printGroupItem.findMany({
          where: { printGroupId: groupId },
          select: { position: true },
        });
        const maxPosition = remaining.reduce(
          (max, r) => Math.max(max, r.position),
          0
        );

        // Create new PrintGroupItems
        const newItems = validFiles.map((file, i) => ({
          printGroupId: groupId,
          orderId: item.orderId,
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

        // Update group totalHeight
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

  return NextResponse.json(updated);
}

/**
 * DELETE /api/order-items/:itemId
 * Clears the designFileUrl (and originalDesignFileUrl) from the item.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { itemId } = await params;

  const item = await prisma.orderItem.findUnique({
    where: { id: itemId },
    include: { order: { select: { id: true, shopifyOrderNumber: true } } },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (!item.designFileUrl) {
    return NextResponse.json({ error: "Item has no print file" }, { status: 400 });
  }

  const oldUrl = item.designFileUrl;

  // Clear file references
  await prisma.orderItem.update({
    where: { id: itemId },
    data: {
      designFileUrl: null,
      originalDesignFileUrl: null,
      isPrinted: false,
      printedAt: null,
    },
  });

  // Log
  await prisma.orderLog.create({
    data: {
      orderId: item.orderId,
      userId: session.user?.id,
      action: "file_deleted",
      fromValue: oldUrl,
      toValue: "",
      message: `Print file deleted from item "${item.title}"`,
    },
  });

  // Cascade to BUILDING print group
  const buildingGroupItem = await prisma.printGroupItem.findFirst({
    where: {
      orderId: item.orderId,
      printGroup: { status: "BUILDING" },
    },
    include: { printGroup: true },
  });

  if (buildingGroupItem) {
    const groupId = buildingGroupItem.printGroupId;

    // Remove this order's items from the group and recalculate
    const groupItems = await prisma.printGroupItem.findMany({
      where: { printGroupId: groupId, orderId: item.orderId },
    });
    const removedHeight = groupItems.reduce((sum, i) => sum + i.heightInches, 0);

    await prisma.printGroupItem.deleteMany({
      where: { printGroupId: groupId, orderId: item.orderId },
    });

    const group = await prisma.printGroup.findUnique({ where: { id: groupId } });
    if (group) {
      await prisma.printGroup.update({
        where: { id: groupId },
        data: { totalHeight: Math.max(0, group.totalHeight - removedHeight) },
      });
    }
  }

  // If all items in the order now have no file AND no extra files, set printStatus to NONE
  const remainingFiles = await prisma.orderItem.count({
    where: { orderId: item.orderId, designFileUrl: { not: null } },
  });
  if (remainingFiles === 0) {
    const order2 = await prisma.order.findUnique({
      where: { id: item.orderId },
      select: { extraPrintFiles: true },
    });
    const extras = Array.isArray(order2?.extraPrintFiles) ? order2.extraPrintFiles : [];
    if (extras.length === 0) {
      await prisma.order.update({
        where: { id: item.orderId },
        data: { printStatus: "NONE" },
      });
    }
  }

  return NextResponse.json({ success: true });
}
