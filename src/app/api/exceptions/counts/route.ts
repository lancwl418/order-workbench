import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/exceptions/counts
 *
 * Returns exception counts for dashboard cards.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeStatuses = ["OPEN", "INVESTIGATING"] as const;

  const [shipmentIssues, processingDelays] = await prisma.$transaction([
    prisma.orderException.count({
      where: {
        type: { in: ["NO_MOVEMENT_AFTER_LABEL", "LONG_TRANSIT", "DELIVERY_FAILURE"] },
        status: { in: [...activeStatuses] },
      },
    }),
    prisma.orderException.count({
      where: {
        type: "PRODUCTION_DELAY",
        status: { in: [...activeStatuses] },
      },
    }),
  ]);

  return NextResponse.json({
    shipmentIssues,
    processingDelays,
    totalOpen: shipmentIssues + processingDelays,
  });
}
