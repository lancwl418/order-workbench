import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTrackDetails } from "@/lib/eccangtms/client";
import { ECCANG_TRAVEL_STATUS } from "@/lib/eccangtms/types";
import { z } from "zod";

const trackSchema = z.object({
  orderId: z.string(),
});

/**
 * POST /api/oms/track
 * Pull tracking details from EccangTMS for an order's OMS shipment.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderId } = parsed.data;

  const shipment = await prisma.shipment.findFirst({
    where: { orderId, providerName: "eccangtms" },
  });

  if (!shipment || !shipment.trackingNumber) {
    return NextResponse.json(
      { error: "No OMS shipment found for this order" },
      { status: 404 }
    );
  }

  try {
    const details = await getTrackDetails([shipment.trackingNumber]);

    if (!details || details.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No tracking info available yet",
        shipment,
      });
    }

    const detail = details[0];
    const mappedStatus =
      ECCANG_TRAVEL_STATUS[String(detail.status)] || "unknown";

    // Update shipment
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: mappedStatus,
        providerRawJson: JSON.parse(JSON.stringify({
          ...(shipment.providerRawJson as Record<string, unknown> || {}),
          lastTrack: detail,
        })),
        ...(mappedStatus === "delivered"
          ? { deliveredAt: new Date(detail.lastDate) }
          : {}),
      },
    });

    // Update order status if delivered
    if (mappedStatus === "delivered") {
      await prisma.order.update({
        where: { id: orderId },
        data: { internalStatus: "DELIVERED" },
      });

      await prisma.orderLog.create({
        data: {
          orderId,
          userId: session.user?.id,
          action: "status_change",
          fromValue: "LABEL_CREATED",
          toValue: "DELIVERED",
          message: "Auto-updated: OMS tracking shows delivered",
        },
      });
    } else if (mappedStatus === "in_transit" || mappedStatus === "collected") {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { internalStatus: true },
      });
      if (order && order.internalStatus === "LABEL_CREATED") {
        await prisma.order.update({
          where: { id: orderId },
          data: { internalStatus: "SHIPPED" },
        });
        await prisma.orderLog.create({
          data: {
            orderId,
            userId: session.user?.id,
            action: "status_change",
            fromValue: "LABEL_CREATED",
            toValue: "SHIPPED",
            message: "Auto-updated: OMS tracking shows in transit",
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      tracking: detail,
      mappedStatus,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch tracking";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
