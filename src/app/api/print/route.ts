import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { printActionSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = printActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderId, action, itemIds, printerName, printConfig, printResult, notes } =
    parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Determine new status
  let newStatus = order.internalStatus;
  if (action === "print_started") {
    newStatus = "PRINTING";
  } else if (action === "print_completed") {
    newStatus = "PRINTED";
  }

  // Create print log
  const printLog = await prisma.printLog.create({
    data: {
      orderId,
      userId: session.user?.id,
      action,
      itemIds: itemIds || order.orderItems.map((i) => i.id),
      printerName,
      printConfig: printConfig ? JSON.parse(JSON.stringify(printConfig)) : undefined,
      printResult,
      reprintFlag: action === "reprint",
      notes,
      completedAt: action === "print_completed" ? new Date() : undefined,
    },
  });

  // Update order status
  if (newStatus !== order.internalStatus) {
    await prisma.order.update({
      where: { id: orderId },
      data: { internalStatus: newStatus },
    });

    await prisma.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "status_change",
        fromValue: order.internalStatus,
        toValue: newStatus,
        message: `Print action: ${action}`,
      },
    });
  }

  // Mark items as printed if completed
  if (action === "print_completed") {
    const targetIds = itemIds || order.orderItems.map((i) => i.id);
    await prisma.orderItem.updateMany({
      where: { id: { in: targetIds } },
      data: { isPrinted: true, printedAt: new Date() },
    });
  }

  return NextResponse.json(printLog);
}
