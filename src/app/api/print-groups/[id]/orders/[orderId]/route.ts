import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, orderId } = await params;

  const group = await prisma.printGroup.findUnique({
    where: { id },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.status === "PRINTED") {
    return NextResponse.json(
      { error: "Cannot remove orders from PRINTED groups" },
      { status: 400 }
    );
  }

  // Delete items for this order in this group
  const deleted = await prisma.printGroupItem.deleteMany({
    where: { printGroupId: id, orderId },
  });

  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "Order not found in this group" },
      { status: 404 }
    );
  }

  // Recalculate total height
  const remaining = await prisma.printGroupItem.aggregate({
    where: { printGroupId: id },
    _sum: { heightInches: true },
  });

  await prisma.printGroup.update({
    where: { id },
    data: { totalHeight: remaining._sum.heightInches || 0 },
  });

  // Set print status back to IN_QUEUE so it stays in the print queue
  await prisma.order.update({
    where: { id: orderId },
    data: { printStatus: "IN_QUEUE" },
  });

  await prisma.orderLog.create({
    data: {
      orderId,
      userId: session.user?.id,
      action: "print_status_change",
      fromValue: group.status === "READY" ? "GROUPED" : "IN_QUEUE",
      toValue: "IN_QUEUE",
      message: `Removed from print group: ${group.name}`,
    },
  });

  // Return updated group
  const updatedGroup = await prisma.printGroup.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          order: {
            select: {
              id: true,
              shopifyOrderNumber: true,
              customerName: true,
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
  });

  return NextResponse.json(updatedGroup);
}
