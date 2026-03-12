import { prisma } from "@/lib/prisma";
import {
  DELIVERY_FAILURE_STATUSES,
  PRODUCTION_COMPLETE_STATUSES,
} from "@/lib/constants";
import {
  resolveExceptionsForShipment,
  resolveExceptionsByType,
} from "./resolver";

/**
 * Called after a shipment tracking update (webhook or manual).
 * Checks for auto-resolution or creates new exceptions.
 */
export async function onShipmentUpdated(shipmentId: string): Promise<void> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, orderId: true, status: true, trackingNumber: true },
  });
  if (!shipment) return;

  const status = shipment.status;

  // Delivered → resolve ALL shipment-related exceptions
  if (status === "delivered") {
    await resolveExceptionsForShipment(shipmentId, "SYSTEM");
    return;
  }

  // Movement detected → resolve NO_MOVEMENT exceptions
  if (status === "in_transit" || status === "out_for_delivery") {
    // Find and resolve only NO_MOVEMENT exceptions for this shipment
    const noMovementExceptions = await prisma.orderException.findMany({
      where: {
        shipmentId,
        type: "NO_MOVEMENT_AFTER_LABEL",
        status: { in: ["OPEN", "INVESTIGATING"] },
      },
    });
    for (const ex of noMovementExceptions) {
      const { resolveExceptionById } = await import("./resolver");
      await resolveExceptionById(ex.id, "SYSTEM");
    }
  }

  // Delivery failure → create exception if not exists
  if (DELIVERY_FAILURE_STATUSES.includes(status as (typeof DELIVERY_FAILURE_STATUSES)[number])) {
    const existing = await prisma.orderException.findFirst({
      where: {
        shipmentId,
        type: "DELIVERY_FAILURE",
        status: { in: ["OPEN", "INVESTIGATING"] },
      },
    });

    if (!existing) {
      await prisma.$transaction([
        prisma.orderException.create({
          data: {
            orderId: shipment.orderId,
            shipmentId: shipment.id,
            type: "DELIVERY_FAILURE",
            severity: "HIGH",
          },
        }),
        prisma.orderLog.create({
          data: {
            orderId: shipment.orderId,
            action: "exception_detected",
            toValue: "DELIVERY_FAILURE",
            message: `Delivery failure detected via webhook (status: ${status}, tracking: ${shipment.trackingNumber})`,
            metadata: { type: "DELIVERY_FAILURE", shipmentId: shipment.id, status },
          },
        }),
      ]);
    }
  }
}

/**
 * Called after an order status change.
 * Auto-resolves PRODUCTION_DELAY if order has progressed.
 */
export async function onOrderStatusChanged(
  orderId: string,
  newStatus: string
): Promise<void> {
  if (
    PRODUCTION_COMPLETE_STATUSES.includes(
      newStatus as (typeof PRODUCTION_COMPLETE_STATUSES)[number]
    )
  ) {
    await resolveExceptionsByType(orderId, "PRODUCTION_DELAY", "SYSTEM");
  }
}
