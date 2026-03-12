import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getProvider } from "@/lib/shipping/provider.registry";
import { z } from "zod";

const createLabelSchema = z.object({
  shipmentId: z.string(),
  providerName: z.string().optional(),
  shippingService: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createLabelSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { shipmentId, providerName, shippingService } = parsed.data;

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          customerName: true,
          shippingAddress: true,
        },
      },
    },
  });

  if (!shipment) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  if (
    shipment.labelStatus === "CREATED" ||
    shipment.labelStatus === "SYNCED_TO_SHOPIFY"
  ) {
    return NextResponse.json(
      { error: "Label already exists for this shipment" },
      { status: 400 }
    );
  }

  const provider = getProvider(providerName);
  const address = (shipment.order.shippingAddress as Record<string, string>) || {};

  const result = await provider.createLabel({
    orderId: shipment.order.id,
    recipientName: shipment.order.customerName || "",
    recipientAddress: {
      address1: address.address1 || "",
      address2: address.address2,
      city: address.city || "",
      province: address.province || "",
      zip: address.zip || "",
      country: address.country || "",
      phone: address.phone,
    },
    shippingService,
  });

  if (result.success) {
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        labelStatus: "CREATED",
        trackingNumber: result.trackingNumber,
        carrier: result.carrier,
        service: result.service,
        labelUrl: result.labelUrl,
        shippingCost: result.shippingCost,
        externalShipmentId: result.externalShipmentId,
        providerName: provider.name,
        providerRawJson: result.rawResponse
          ? JSON.parse(JSON.stringify(result.rawResponse))
          : undefined,
      },
    });

    // Update denormalized fields on order
    if (result.trackingNumber) {
      await prisma.order.update({
        where: { id: shipment.order.id },
        data: {
          trackingNumber: result.trackingNumber,
          carrier: result.carrier,
          labelStatus: "CREATED",
          labelUrl: result.labelUrl,
          internalStatus: "LABEL_CREATED",
        },
      });
    }

    await prisma.orderLog.create({
      data: {
        orderId: shipment.order.id,
        userId: session.user?.id,
        action: "label_created",
        toValue: result.trackingNumber || "pending",
        message: `Label created via ${provider.name}`,
      },
    });
  }

  return NextResponse.json(result);
}
