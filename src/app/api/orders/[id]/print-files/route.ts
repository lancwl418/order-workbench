import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  resolveGangSheetUrls,
  isDirectImageUrl,
  type ResolvedPrintFile,
} from "@/lib/drip/resolve-gang-sheet";

/**
 * GET /api/orders/:id/print-files
 *
 * Returns all downloadable print files for an order.
 * - Build a Gangsheet: returns direct image URLs as-is
 * - Transfer by Size: resolves page URLs to actual gang_sheet_url images
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
      orderItems: {
        select: {
          id: true,
          title: true,
          variantTitle: true,
          designFileUrl: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Build a map of URL -> label from line items (for friendly filenames)
  const urlLabelMap = new Map<string, string>();
  const seen = new Set<string>();

  const files: ResolvedPrintFile[] = [];

  for (const item of order.orderItems) {
    if (!item.designFileUrl || seen.has(item.designFileUrl)) continue;
    seen.add(item.designFileUrl);

    const url = item.designFileUrl;

    if (isDirectImageUrl(url)) {
      // Build a Gangsheet — direct image URL, use variant as label
      const label = item.variantTitle || item.title;
      const orderNum = order.shopifyOrderNumber?.replace("#", "") || "";
      const filename = `${orderNum}-${label}.png`;
      files.push({ url, filename });
    } else {
      // Transfer by Size — resolve page URL to actual images
      const resolved = await resolveGangSheetUrls(url);
      files.push(...resolved);
    }
  }

  return NextResponse.json({ files });
}
