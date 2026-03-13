import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeStatuses = ["OPEN", "INVESTIGATING"] as const;

  const [statusCounts, printStatusCounts, total, shipmentIssues, processingDelays] =
    await prisma.$transaction([
      prisma.order.groupBy({
        by: ["internalStatus"],
        orderBy: { internalStatus: "asc" },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ["printStatus"],
        orderBy: { printStatus: "asc" },
        _count: { _all: true },
      }),
      prisma.order.count(),
      prisma.orderException.count({
        where: {
          type: {
            in: [
              "NO_MOVEMENT_AFTER_LABEL",
              "LONG_TRANSIT",
              "DELIVERY_FAILURE",
            ],
          },
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

  const counts: Record<string, number> = {};
  for (const row of statusCounts) {
    counts[row.internalStatus] = (row._count as { _all: number })._all;
  }
  // Print status counts
  const printStatusMap: Record<string, string> = {
    NONE: "_printNone",
    READY: "_printReady",
    IN_QUEUE: "_printInQueue",
    GROUPED: "_printGrouped",
    DONE: "_printDone",
  };
  for (const row of printStatusCounts) {
    const key = printStatusMap[row.printStatus] || `_print${row.printStatus}`;
    counts[key] = (row._count as { _all: number })._all;
  }
  counts._total = total;
  counts._shipmentIssues = shipmentIssues;
  counts._processingDelays = processingDelays;
  counts._exceptions = shipmentIssues + processingDelays;

  return NextResponse.json(counts);
}
