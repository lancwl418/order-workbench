import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
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
    include: { items: { select: { orderId: true } } },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.status !== "BUILDING") {
    return NextResponse.json(
      { error: "Only BUILDING groups can be combined" },
      { status: 400 }
    );
  }

  if (group.items.length === 0) {
    return NextResponse.json(
      { error: "Cannot combine an empty group" },
      { status: 400 }
    );
  }

  await prisma.printGroup.update({
    where: { id },
    data: { status: "READY" },
  });

  // Update all orders in the group to GROUPED print status
  const orderIds = [...new Set(group.items.map((item) => item.orderId))];
  if (orderIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { printStatus: "GROUPED" },
    });
  }

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
