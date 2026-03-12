import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shipmentCreateSchema } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");

  const where = orderId ? { orderId } : {};

  const shipments = await prisma.shipment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      order: {
        select: { shopifyOrderNumber: true, customerName: true },
      },
    },
  });

  return NextResponse.json(shipments);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = shipmentCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: { _count: { select: { shipments: true } } },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const shipment = await prisma.shipment.create({
    data: {
      ...parsed.data,
      packageNumber: order._count.shipments + 1,
    },
  });

  await prisma.orderLog.create({
    data: {
      orderId: parsed.data.orderId,
      userId: session.user?.id,
      action: "shipment_created",
      toValue: shipment.id,
      message: `Shipment #${shipment.packageNumber} created`,
    },
  });

  return NextResponse.json(shipment, { status: 201 });
}
