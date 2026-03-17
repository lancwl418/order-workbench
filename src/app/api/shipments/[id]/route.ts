import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { shipmentUpdateSchema } from "@/lib/validators";
import { pushFulfillmentToShopify } from "@/lib/shopify/fulfillments";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const shipment = await prisma.shipment.findUnique({
    where: { id },
    include: {
      order: {
        select: {
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

  return NextResponse.json(shipment);
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
  const parsed = shipmentUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.shipment.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }

  const shipment = await prisma.shipment.update({
    where: { id },
    data: parsed.data,
  });

  // Log tracking number changes
  if (
    parsed.data.trackingNumber &&
    parsed.data.trackingNumber !== existing.trackingNumber
  ) {
    await prisma.orderLog.create({
      data: {
        orderId: existing.orderId,
        userId: session.user?.id,
        action: "tracking_updated",
        fromValue: existing.trackingNumber || "",
        toValue: parsed.data.trackingNumber,
        message: `Tracking number updated for shipment #${existing.packageNumber}`,
      },
    });

    // Also update the denormalized tracking on the order
    const order = await prisma.order.update({
      where: { id: existing.orderId },
      data: {
        trackingNumber: parsed.data.trackingNumber,
        carrier: parsed.data.carrier || existing.carrier,
      },
    });

    // Auto-sync to Shopify if order has a Shopify ID and not already synced
    if (order.shopifyOrderId && shipment.syncStatus !== "SYNCED") {
      try {
        const result = await pushFulfillmentToShopify({
          shopifyOrderId: order.shopifyOrderId,
          trackingNumber: parsed.data.trackingNumber,
          carrier: "USPS",
        });

        await prisma.shipment.update({
          where: { id },
          data: {
            shopifyFulfillmentId: result.fulfillmentId,
            syncStatus: "SYNCED",
            labelStatus: "SYNCED_TO_SHOPIFY",
            status: "shipped",
            shippedAt: new Date(),
          },
        });

        await prisma.order.update({
          where: { id: existing.orderId },
          data: {
            labelStatus: "SYNCED_TO_SHOPIFY",
            fulfillmentPushedAt: new Date(),
          },
        });

        console.log(`Auto-synced fulfillment to Shopify for order ${order.shopifyOrderNumber}`);
      } catch (e) {
        console.error(`Auto-sync to Shopify failed for shipment ${id}:`, e);
        await prisma.shipment.update({
          where: { id },
          data: { syncStatus: "FAILED", syncError: e instanceof Error ? e.message : "Auto-sync failed" },
        });
      }
    }
  }

  return NextResponse.json(shipment);
}
