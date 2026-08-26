import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureBlanksSplit } from "@/lib/orders/blanks-split";
import { resyncPendingTrackings } from "@/lib/suppliers/push-service";

/**
 * POST /api/orders/[id]/split-blanks
 *
 * Ensure the order's blanks live in their own fulfillment group(s) — one per
 * supplier when pushed to several factories. After splitting, any factory
 * trackings that were waiting on the split are synced to Shopify.
 * Returns { split, blanksFulfillmentOrderId } for label creation to target.
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
  const result = await ensureBlanksSplit(id, session.user?.id);
  if (result.error) {
    const status = result.error === "Order not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Factory trackings captured before the split can now sync to Shopify
  await resyncPendingTrackings(id, session.user?.id);

  const firstBlank = await prisma.orderItem.findFirst({
    where: { orderId: id, itemType: "other" },
    select: { shopifyFulfillmentOrderId: true },
  });

  return NextResponse.json({
    split: result.split,
    blanksFulfillmentOrderId: firstBlank?.shopifyFulfillmentOrderId ?? null,
  });
}
