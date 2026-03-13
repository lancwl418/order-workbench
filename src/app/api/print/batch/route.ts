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
  const newPrintStatus = action === "print_started" ? "IN_QUEUE" : "DONE";

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

  // Update print statuses
  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { printStatus: newPrintStatus },
  });

  // Log print status changes
  const logEntries = orders
    .filter((o) => o.printStatus !== newPrintStatus)
    .map((order) => ({
      orderId: order.id,
      userId: session.user?.id,
      action: "print_status_change",
      fromValue: order.printStatus,
      toValue: newPrintStatus,
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
    message: `${orderIds.length} orders print status updated to ${newPrintStatus}`,
  });
}
