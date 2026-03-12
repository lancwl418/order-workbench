import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Generic webhook handler for shipping provider status updates
  const { externalShipmentId, trackingNumber, carrier, status, estimatedDelivery } =
    body;

  if (!externalShipmentId && !trackingNumber) {
    return NextResponse.json(
      { error: "externalShipmentId or trackingNumber required" },
      { status: 400 }
    );
  }

  const shipment = await prisma.shipment.findFirst({
    where: externalShipmentId
      ? { externalShipmentId }
      : { trackingNumber },
  });

  if (!shipment) {
    return NextResponse.json(
      { error: "Shipment not found" },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (trackingNumber) updateData.trackingNumber = trackingNumber;
  if (carrier) updateData.carrier = carrier;
  if (status) updateData.status = status;
  if (estimatedDelivery)
    updateData.estimatedDelivery = new Date(estimatedDelivery);

  if (status === "delivered") {
    updateData.deliveredAt = new Date();
  }
  if (status === "shipped" || status === "in_transit") {
    updateData.shippedAt = updateData.shippedAt || new Date();
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: updateData,
  });

  // Update denormalized order fields
  if (trackingNumber || carrier) {
    await prisma.order.update({
      where: { id: shipment.orderId },
      data: {
        ...(trackingNumber ? { trackingNumber } : {}),
        ...(carrier ? { carrier } : {}),
      },
    });
  }

  await prisma.orderLog.create({
    data: {
      orderId: shipment.orderId,
      action: "shipping_status_update",
      toValue: status || "updated",
      message: `Shipping provider webhook: ${status || "update"}`,
    },
  });

  return NextResponse.json({ received: true });
}
