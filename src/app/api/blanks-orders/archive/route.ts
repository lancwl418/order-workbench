import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  orderIds: z.array(z.string()).min(1).max(500),
  archived: z.boolean(),
});

/**
 * POST /api/blanks-orders/archive — hide orders from (or restore them to)
 * the Blanks / Printed Apparel push workbench. Only sets pushArchivedAt;
 * nothing else about the order changes.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { orderIds, archived } = parsed.data;

  const result = await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { pushArchivedAt: archived ? new Date() : null },
  });

  return NextResponse.json({ updated: result.count, archived });
}
