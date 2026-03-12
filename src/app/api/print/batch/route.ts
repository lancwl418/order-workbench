import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const batchPrintSchema = z.object({
  orderIds: z.array(z.string()).min(1),
  action: z.enum(["print_started", "print_completed"]),
  printerName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = batchPrintSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderIds, action, printerName } = parsed.data;
  const newStatus = action === "print_started" ? "PRINTING" : "PRINTED";

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { orderItems: true },
  });

  // Create print logs for each order
  const printLogs = orders.map((order) => ({
    orderId: order.id,
    userId: session.user?.id,
    action,
    itemIds: order.orderItems.map((i) => i.id),
    printerName,
  }));

  await prisma.printLog.createMany({ data: printLogs });

  // Update order statuses
  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { internalStatus: newStatus },
  });

  // Log status changes
  const logEntries = orders
    .filter((o) => o.internalStatus !== newStatus)
    .map((order) => ({
      orderId: order.id,
      userId: session.user?.id,
      action: "status_change",
      fromValue: order.internalStatus,
      toValue: newStatus,
      message: `Batch print: ${action}`,
    }));

  if (logEntries.length > 0) {
    await prisma.orderLog.createMany({ data: logEntries });
  }

  // Mark items as printed if completed
  if (action === "print_completed") {
    const allItemIds = orders.flatMap((o) => o.orderItems.map((i) => i.id));
    await prisma.orderItem.updateMany({
      where: { id: { in: allItemIds } },
      data: { isPrinted: true, printedAt: new Date() },
    });
  }

  return NextResponse.json({
    processed: orderIds.length,
    message: `${orderIds.length} orders updated to ${newStatus}`,
  });
}
