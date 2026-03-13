import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateGroupSchema = z.object({
  status: z.enum(["PRINTED"]),
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

  // Update all orders to PRINTED
  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: { internalStatus: "PRINTED" },
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
    action: "status_change",
    fromValue: "PRINTING",
    toValue: "PRINTED",
    message: `Print group completed: ${group.name}`,
  }));

  await prisma.orderLog.createMany({ data: logEntries });

  return NextResponse.json({ success: true, ordersUpdated: orderIds.length });
}
