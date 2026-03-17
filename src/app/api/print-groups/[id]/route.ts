import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateGroupSchema = z.object({
  status: z.enum(["PRINTED"]).optional(),
  name: z.string().min(1).max(100).optional(),
});

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
  const parsed = updateGroupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const group = await prisma.printGroup.findUnique({
    where: { id },
    include: {
      items: {
        select: { orderId: true },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Handle name-only update (any status)
  if (parsed.data.name && !parsed.data.status) {
    const updated = await prisma.printGroup.update({
      where: { id },
      data: { name: parsed.data.name, combinedFileUrl: null },
    });
    return NextResponse.json(updated);
  }

  if (parsed.data.status !== "PRINTED") {
    return NextResponse.json(
      { error: "Invalid update" },
      { status: 400 }
    );
  }

  if (group.status !== "READY") {
    return NextResponse.json(
      { error: "Only READY groups can be marked as PRINTED" },
      { status: 400 }
    );
  }

  // Update group status
  await prisma.printGroup.update({
    where: { id },
    data: { status: "PRINTED" },
  });

  // Get unique order IDs in the group
  const orderIds = [...new Set(group.items.map((item) => item.orderId))];

  // Update all orders printStatus to PRINTED
  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { printStatus: "DONE" },
  });

  // Mark all order items as printed
  await prisma.orderItem.updateMany({
    where: { orderId: { in: orderIds } },
    data: { isPrinted: true, printedAt: new Date() },
  });

  // Create order logs
  const logEntries = orderIds.map((orderId) => ({
    orderId,
    userId: session.user?.id,
    action: "print_status_change",
    fromValue: "GROUPED",
    toValue: "DONE",
    message: `Print group completed: ${group.name}`,
  }));

  await prisma.orderLog.createMany({ data: logEntries });

  return NextResponse.json({ success: true, ordersUpdated: orderIds.length });
}

// Release (dissolve) an entire group - orders go back to IN_QUEUE
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.printGroup.findUnique({
    where: { id },
    include: {
      items: {
        select: { orderId: true },
      },
    },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.status === "PRINTED") {
    return NextResponse.json(
      { error: "Cannot release a PRINTED group" },
      { status: 400 }
    );
  }

  const orderIds = [...new Set(group.items.map((item) => item.orderId))];

  // Delete the group (cascades to items)
  await prisma.printGroup.delete({ where: { id } });

  // Set orders back to IN_QUEUE print status
  if (orderIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { printStatus: "IN_QUEUE" },
    });

    await prisma.orderLog.createMany({
      data: orderIds.map((orderId) => ({
        orderId,
        userId: session.user?.id,
        action: "print_status_change",
        fromValue: group.status === "READY" ? "GROUPED" : "IN_QUEUE",
        toValue: "IN_QUEUE",
        message: `Released from print group: ${group.name}`,
      })),
    });
  }

  return NextResponse.json({ success: true, ordersReleased: orderIds.length });
}
