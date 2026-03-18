import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveGangSheetUrls,
  isDirectImageUrl,
  type ResolvedPrintFile,
} from "@/lib/drip/resolve-gang-sheet";

export type PrintFileWithSource = ResolvedPrintFile & {
  sourceUrl: string;
  orderItemIds: string[];
  hasOriginal: boolean;
  originalSourceUrl: string | null;
  /** "current" = active file, "original" = before replacement */
  version: "current" | "original";
};

/**
 * GET /api/orders/:id/print-files
 *
 * Returns all downloadable print files for an order.
 * When a file has been replaced, lists both current and original versions.
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

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      shopifyOrderNumber: true,
      extraPrintFiles: true,
      orderItems: {
        select: {
          id: true,
          title: true,
          variantTitle: true,
          designFileUrl: true,
          originalDesignFileUrl: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const orderNum = order.shopifyOrderNumber?.replace("#", "") || "";

  // Group order items by unique designFileUrl
  const urlGroups = new Map<
    string,
    { label: string; itemIds: string[]; originalUrl: string | null }
  >();

  for (const item of order.orderItems) {
    if (!item.designFileUrl) continue;
    const existing = urlGroups.get(item.designFileUrl);
    if (existing) {
      existing.itemIds.push(item.id);
    } else {
      urlGroups.set(item.designFileUrl, {
        label: item.variantTitle || item.title,
        itemIds: [item.id],
        originalUrl: item.originalDesignFileUrl,
      });
    }
  }

  const files: PrintFileWithSource[] = [];

  for (const [sourceUrl, group] of urlGroups) {
    const wasReplaced = !!group.originalUrl && group.originalUrl !== sourceUrl;

    if (wasReplaced && group.originalUrl) {
      // Resolve original first to get the real filename
      const origFiles = await resolveUrl(group.originalUrl, orderNum, group.label);

      // Current (replaced) files use REPLACED-originalFilename
      const currentFiles = await resolveUrl(sourceUrl, orderNum, group.label);
      for (let j = 0; j < currentFiles.length; j++) {
        const origName = origFiles[j]?.filename || origFiles[0]?.filename || group.label;
        const baseName = origName.replace(/\.[^.]+$/, "");
        const ext = origName.includes(".") ? origName.split(".").pop() : "png";
        files.push({
          ...currentFiles[j],
          filename: `REPLACED-${baseName}.${ext}`,
          sourceUrl,
          orderItemIds: group.itemIds,
          hasOriginal: true,
          originalSourceUrl: group.originalUrl,
          version: "current",
        });
      }

      // Original files
      for (const f of origFiles) {
        files.push({
          ...f,
          sourceUrl: group.originalUrl,
          orderItemIds: group.itemIds,
          hasOriginal: false,
          originalSourceUrl: null,
          version: "original",
        });
      }
    } else {
      // No replacement, just resolve current
      const currentFiles = await resolveUrl(sourceUrl, orderNum, group.label);
      for (const f of currentFiles) {
        files.push({
          ...f,
          sourceUrl,
          orderItemIds: group.itemIds,
          hasOriginal: false,
          originalSourceUrl: null,
          version: "current",
        });
      }
    }
  }

  // Append extra print files (not tied to order items)
  const extras = (order.extraPrintFiles as { url: string; filename: string }[] | null) || [];
  for (const extra of extras) {
    files.push({
      url: extra.url,
      filename: extra.filename,
      sourceUrl: extra.url,
      orderItemIds: [],
      hasOriginal: false,
      originalSourceUrl: null,
      version: "current",
    });
  }

  return NextResponse.json({ files });
}

async function resolveUrl(
  url: string,
  orderNum: string,
  label: string
): Promise<ResolvedPrintFile[]> {
  if (isDirectImageUrl(url)) {
    const filename = `${orderNum}-${label}.png`;
    return [{ url, filename }];
  }
  return resolveGangSheetUrls(url);
}
