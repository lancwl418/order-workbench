import { prisma } from "@/lib/prisma";
import { PRODUCTION_COMPLETE_STATUSES } from "@/lib/constants";

/**
 * Auto-resolve exceptions whose conditions are no longer met.
 * Called by both the cron scanner and real-time webhook hooks.
 */
export async function autoResolveExceptions(): Promise<number> {
  let resolved = 0;
  resolved += await resolveShippingExceptionsWithDeliveredSibling();
  resolved += await resolveNoMovementExceptions();
  resolved += await resolveLongTransitExceptions();
  resolved += await resolveDeliveryFailureExceptions();
  resolved += await resolveProductionDelayExceptions();
  return resolved;
}

/**
 * Resolve a specific exception by ID.
 */
export async function resolveExceptionById(
  exceptionId: string,
  resolvedBy: string
): Promise<void> {
  const exception = await prisma.orderException.findUnique({
    where: { id: exceptionId },
  });
  if (!exception || exception.status === "RESOLVED" || exception.status === "AUTO_RESOLVED") {
    return;
  }

  await prisma.$transaction([
    prisma.orderException.update({
      where: { id: exceptionId },
      data: {
        status: resolvedBy === "SYSTEM" ? "AUTO_RESOLVED" : "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy,
      },
    }),
    prisma.orderLog.create({
      data: {
        orderId: exception.orderId,
        action: resolvedBy === "SYSTEM" ? "exception_auto_resolved" : "exception_resolved",
        fromValue: exception.status,
        toValue: resolvedBy === "SYSTEM" ? "AUTO_RESOLVED" : "RESOLVED",
        message: `Exception ${exception.type} ${resolvedBy === "SYSTEM" ? "auto-" : ""}resolved`,
        metadata: { exceptionId, type: exception.type, resolvedBy },
      },
    }),
  ]);
}

/**
 * Resolve all open exceptions for a specific shipment.
 */
export async function resolveExceptionsForShipment(
  shipmentId: string,
  resolvedBy: string
): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      shipmentId,
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
  });

  for (const ex of exceptions) {
    await resolveExceptionById(ex.id, resolvedBy);
  }

  return exceptions.length;
}

/**
 * Resolve open exceptions of a specific type for an order.
 */
export async function resolveExceptionsByType(
  orderId: string,
  type: string,
  resolvedBy: string
): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      orderId,
      type: type as "NO_MOVEMENT_AFTER_LABEL" | "LONG_TRANSIT" | "DELIVERY_FAILURE" | "PRODUCTION_DELAY",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
  });

  for (const ex of exceptions) {
    await resolveExceptionById(ex.id, resolvedBy);
  }

  return exceptions.length;
}

// ─── Internal auto-resolution scanners ────────────────────────

/**
 * Resolve shipping exceptions where another shipment on the same order
 * has already been delivered (the failed/stuck shipment is irrelevant).
 */
async function resolveShippingExceptionsWithDeliveredSibling(): Promise<number> {
  const shippingTypes = [
    "NO_MOVEMENT_AFTER_LABEL",
    "LONG_TRANSIT",
    "DELIVERY_FAILURE",
  ] as const;

  const exceptions = await prisma.orderException.findMany({
    where: {
      type: { in: [...shippingTypes] },
      status: { in: ["OPEN", "INVESTIGATING"] },
      shipmentId: { not: null },
    },
    include: {
      order: {
        select: {
          shipments: { select: { id: true, status: true } },
        },
      },
    },
  });

  let resolved = 0;
  for (const ex of exceptions) {
    const hasDeliveredSibling = ex.order.shipments.some(
      (s) => s.id !== ex.shipmentId && s.status === "delivered"
    );
    if (hasDeliveredSibling) {
      await resolveExceptionById(ex.id, "SYSTEM");
      resolved++;
    }
  }
  return resolved;
}

/**
 * NO_MOVEMENT: resolve if shipment now shows movement.
 */
async function resolveNoMovementExceptions(): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      type: "NO_MOVEMENT_AFTER_LABEL",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
    include: {
      shipment: { select: { id: true, status: true } },
    },
  });

  let resolved = 0;
  for (const ex of exceptions) {
    const shipmentStatus = ex.shipment?.status;
    if (
      shipmentStatus === "in_transit" ||
      shipmentStatus === "out_for_delivery" ||
      shipmentStatus === "delivered"
    ) {
      await resolveExceptionById(ex.id, "SYSTEM");
      resolved++;
    }
  }
  return resolved;
}

/**
 * LONG_TRANSIT: resolve if delivered or out for delivery.
 */
async function resolveLongTransitExceptions(): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      type: "LONG_TRANSIT",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
    include: {
      shipment: { select: { id: true, status: true } },
    },
  });

  let resolved = 0;
  for (const ex of exceptions) {
    const shipmentStatus = ex.shipment?.status;
    if (shipmentStatus === "delivered" || shipmentStatus === "out_for_delivery") {
      await resolveExceptionById(ex.id, "SYSTEM");
      resolved++;
    }
  }
  return resolved;
}

/**
 * DELIVERY_FAILURE: resolve if now delivered.
 */
async function resolveDeliveryFailureExceptions(): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      type: "DELIVERY_FAILURE",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
    include: {
      shipment: { select: { id: true, status: true } },
    },
  });

  let resolved = 0;
  for (const ex of exceptions) {
    if (ex.shipment?.status === "delivered") {
      await resolveExceptionById(ex.id, "SYSTEM");
      resolved++;
    }
  }
  return resolved;
}

/**
 * PRODUCTION_DELAY: resolve if order has progressed past production.
 */
async function resolveProductionDelayExceptions(): Promise<number> {
  const exceptions = await prisma.orderException.findMany({
    where: {
      type: "PRODUCTION_DELAY",
      status: { in: ["OPEN", "INVESTIGATING"] },
    },
    include: {
      order: { select: { id: true, internalStatus: true } },
    },
  });

  let resolved = 0;
  for (const ex of exceptions) {
    if (
      PRODUCTION_COMPLETE_STATUSES.includes(
        ex.order.internalStatus as (typeof PRODUCTION_COMPLETE_STATUSES)[number]
      )
    ) {
      await resolveExceptionById(ex.id, "SYSTEM");
      resolved++;
    }
  }
  return resolved;
}
