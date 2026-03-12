import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bulkUpdateSchema } from "@/lib/validators";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = bulkUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderIds, ...updateData } = parsed.data;

  // Get existing orders for logging
  const existingOrders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, internalStatus: true, shippingRoute: true },
  });

  // Update all orders
  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: updateData,
  });

  // Log changes
  const logEntries = existingOrders.flatMap((order) => {
    const logs = [];
    if (
      updateData.internalStatus &&
      updateData.internalStatus !== order.internalStatus
    ) {
      logs.push({
        orderId: order.id,
        userId: session.user?.id,
        action: "status_change",
        fromValue: order.internalStatus,
        toValue: updateData.internalStatus,
        message: `Bulk status change to ${updateData.internalStatus}`,
      });
    }
    if (
      updateData.shippingRoute &&
      updateData.shippingRoute !== order.shippingRoute
    ) {
      logs.push({
        orderId: order.id,
        userId: session.user?.id,
        action: "route_change",
        fromValue: order.shippingRoute,
        toValue: updateData.shippingRoute,
        message: `Bulk route change to ${updateData.shippingRoute}`,
      });
    }
    return logs;
  });

  if (logEntries.length > 0) {
    await prisma.orderLog.createMany({ data: logEntries });
  }

  return NextResponse.json({
    updated: orderIds.length,
    message: `${orderIds.length} orders updated`,
  });
}
