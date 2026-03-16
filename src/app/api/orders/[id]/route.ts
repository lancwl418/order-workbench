import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderUpdateSchema } from "@/lib/validators";
import { onOrderStatusChanged } from "@/lib/exceptions/realtime";
import { INTERNAL_STATUSES } from "@/lib/constants";

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

  // Auto-set REVIEW when CS-flagged, revert to previous status when unflagged
  if (updateData.csFlag !== undefined && updateData.csFlag !== existing.csFlag && !updateData.internalStatus) {
    if (updateData.csFlag) {
      updateData.internalStatus = "REVIEW";
    } else {
      // Look up the status before CS was flagged
      const flagLog = await prisma.orderLog.findFirst({
        where: { orderId: id, action: "cs_flagged" },
        orderBy: { createdAt: "desc" },
      });
      const previousStatus = flagLog?.fromValue;
      const validStatuses: readonly string[] = INTERNAL_STATUSES;
      if (previousStatus && validStatuses.includes(previousStatus) && previousStatus !== existing.internalStatus) {
        (updateData as Record<string, unknown>).internalStatus = previousStatus;
      } else if (existing.internalStatus === "REVIEW") {
        updateData.internalStatus = "OPEN";
      }
    }
  }

  // Auto-sync printStatus based on order status changes
  if (updateData.internalStatus && !updateData.printStatus) {
    const DONE_TRIGGER = ["SHIPPED", "DELAYED", "DISMISSED", "CANCELLED"];
    const READY_TRIGGER = ["OPEN", "REVIEW", "LABEL_CREATED"];
    if (DONE_TRIGGER.includes(updateData.internalStatus) && existing.printStatus !== "DONE") {
      (updateData as Record<string, unknown>).printStatus = "DONE";
    } else if (READY_TRIGGER.includes(updateData.internalStatus) && existing.printStatus === "DONE") {
      (updateData as Record<string, unknown>).printStatus = "READY";
    }
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
    updateData.printStatus &&
    updateData.printStatus !== existing.printStatus
  ) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: "print_status_change",
      fromValue: existing.printStatus,
      toValue: updateData.printStatus,
      message: `Print status changed from ${existing.printStatus} to ${updateData.printStatus}`,
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
      fromValue: existing.internalStatus,
      toValue: updateData.csFlag ? "REVIEW" : (updateData.internalStatus || existing.internalStatus),
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
  if (
    updateData.shippingMethod !== undefined &&
    updateData.shippingMethod !== existing.shippingMethod
  ) {
    logEntries.push({
      orderId: id,
      userId: session.user?.id,
      action: "delivery_method_change",
      fromValue: existing.shippingMethod || "",
      toValue: updateData.shippingMethod || "",
      message: `Delivery method changed from "${existing.shippingMethod || "-"}" to "${updateData.shippingMethod || "-"}"`,
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
