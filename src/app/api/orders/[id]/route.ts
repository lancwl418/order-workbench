import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderUpdateSchema } from "@/lib/validators";
import { onOrderStatusChanged } from "@/lib/exceptions/realtime";

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
    include: {
      orderItems: true,
      shipments: { orderBy: { createdAt: "desc" } },
      orderLogs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { user: { select: { displayName: true, username: true } } },
      },
      printLogs: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: { user: { select: { displayName: true, username: true } } },
      },
      exceptions: {
        where: { status: { in: ["OPEN", "INVESTIGATING"] } },
        orderBy: { detectedAt: "desc" },
        include: {
          shipment: {
            select: { trackingNumber: true, carrier: true, status: true },
          },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = orderUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const updateData = parsed.data;

  // Handle ON_HOLD status transitions
  if (updateData.internalStatus === "ON_HOLD" && !updateData.holdReason) {
    // Allow but don't overwrite existing holdReason
  }
  if (
    updateData.internalStatus === "ON_HOLD" &&
    existing.internalStatus !== "ON_HOLD"
  ) {
    (updateData as Record<string, unknown>).holdAt = new Date();
  }
  if (
    updateData.internalStatus &&
    updateData.internalStatus !== "ON_HOLD" &&
    existing.internalStatus === "ON_HOLD"
  ) {
    (updateData as Record<string, unknown>).holdAt = null;
    (updateData as Record<string, unknown>).holdReason = null;
  }

  const order = await prisma.order.update({
    where: { id },
    data: updateData,
    include: {
      orderItems: true,
      _count: { select: { shipments: true } },
    },
  });

  // Log changes
  const logEntries = [];
  if (
    updateData.internalStatus &&
    updateData.internalStatus !== existing.internalStatus
  ) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: "status_change",
      fromValue: existing.internalStatus,
      toValue: updateData.internalStatus,
      message: `Status changed from ${existing.internalStatus} to ${updateData.internalStatus}`,
    });
  }
  if (
    updateData.shippingRoute &&
    updateData.shippingRoute !== existing.shippingRoute
  ) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: "route_change",
      fromValue: existing.shippingRoute,
      toValue: updateData.shippingRoute,
      message: `Shipping route changed to ${updateData.shippingRoute}`,
    });
  }
  if (updateData.csFlag !== undefined && updateData.csFlag !== existing.csFlag) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: updateData.csFlag ? "cs_flagged" : "cs_unflagged",
      fromValue: String(existing.csFlag),
      toValue: String(updateData.csFlag),
    });
  }
  if (updateData.notes !== undefined && updateData.notes !== existing.notes) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: "note_added",
      toValue: updateData.notes || "",
    });
  }

  if (logEntries.length > 0) {
    await prisma.orderLog.createMany({ data: logEntries });
  }

  // Real-time exception resolution on status change
  if (
    updateData.internalStatus &&
    updateData.internalStatus !== existing.internalStatus
  ) {
    onOrderStatusChanged(id, updateData.internalStatus).catch(() => {});
  }

  return NextResponse.json(order);
}
