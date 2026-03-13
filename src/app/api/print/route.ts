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

  // Determine new print status
  let newPrintStatus = order.printStatus;
  if (action === "print_started") {
    newPrintStatus = "IN_QUEUE";
  } else if (action === "print_completed") {
    newPrintStatus = "DONE";
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

  // Update print status
  if (newPrintStatus !== order.printStatus) {
    await prisma.order.update({
      where: { id: orderId },
      data: { printStatus: newPrintStatus },
    });

    await prisma.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "print_status_change",
        fromValue: order.printStatus,
        toValue: newPrintStatus,
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
