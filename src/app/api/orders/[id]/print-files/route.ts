import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ResolvedPrintFile } from "@/lib/drip/resolve-gang-sheet";
import {
  groupPrintFileSources,
  resolvePrintFileSource,
  extraPrintFilesOf,
} from "@/lib/drip/order-print-files";
import { refreshPrintFileUrls } from "@/lib/shopify/refresh-print-urls";

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

  // Refresh URLs from Shopify before loading (catches gangsheet updates)
  await refreshPrintFileUrls(id);

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
          quantity: true,
          itemType: true,
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

  const sources = groupPrintFileSources(order.orderItems);

  const files: PrintFileWithSource[] = [];

  for (const group of sources) {
    const sourceUrl = group.url;
    const resolve = (url: string) =>
      resolvePrintFileSource(url, { orderNum, label: group.label, copies: group.copies });
    const wasReplaced = !!group.originalUrl && group.originalUrl !== sourceUrl;

    if (wasReplaced && group.originalUrl) {
      // Resolve original first to get the real filename
      const origFiles = await resolve(group.originalUrl);

      // Current (replaced) files use REPLACED-originalFilename
      const currentFiles = await resolve(sourceUrl);
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
      const currentFiles = await resolve(sourceUrl);
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
  for (const extra of extraPrintFilesOf(order.extraPrintFiles)) {
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

  return NextResponse.json({ files }, {
    headers: { "Cache-Control": "no-store" },
  });
}
