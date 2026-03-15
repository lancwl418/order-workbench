import { prisma } from "@/lib/prisma";
import { differenceInCalendarDays, differenceInHours, subDays } from "date-fns";
import { differenceInBusinessDays } from "./business-days";
import { autoResolveExceptions } from "./resolver";
import {
  EXCEPTION_THRESHOLDS,
  DELIVERY_FAILURE_STATUSES,
} from "@/lib/constants";

export interface ScanResult {
  detected: number;
  autoResolved: number;
  errors: string[];
}

/**
 * Main scan entry point. Runs all four detectors + auto-recovery.
 */
export async function scanAllExceptions(): Promise<ScanResult> {
  const result: ScanResult = { detected: 0, autoResolved: 0, errors: [] };

  const detectors = [
    { name: "NO_MOVEMENT", fn: detectNoMovementAfterLabel },
    { name: "LONG_TRANSIT", fn: detectLongTransit },
    { name: "DELIVERY_FAILURE", fn: detectDeliveryFailure },
    { name: "PRODUCTION_DELAY", fn: detectProductionDelay },
  ];

  for (const { name, fn } of detectors) {
    try {
      const count = await fn();
      result.detected += count;
    } catch (e) {
      result.errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  try {
    result.autoResolved = await autoResolveExceptions();
  } catch (e) {
    result.errors.push(`AUTO_RESOLVE: ${(e as Error).message}`);
  }

  return result;
}

/**
 * A. No Movement — shipment has tracking but still stuck in "confirmed" status
 * for >= 2 calendar days. No in_transit, no delivered, no failure — nothing moved.
 */
async function detectNoMovementAfterLabel(): Promise<number> {
  const threshold = subDays(new Date(), EXCEPTION_THRESHOLDS.NO_MOVEMENT_DAYS);
  const now = new Date();

  const shipments = await prisma.shipment.findMany({
    where: {
      trackingNumber: { not: null },
      status: "confirmed",
      shippedAt: { lte: threshold },
      order: {
        internalStatus: { notIn: ["CANCELLED"] },
      },
    },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          shipments: { select: { id: true, status: true } },
        },
      },
      exceptions: {
        where: { type: "NO_MOVEMENT_AFTER_LABEL" },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    const hasDelivered = shipment.order.shipments.some(
      (s) => s.id !== shipment.id && s.status === "delivered"
    );
    if (hasDelivered) continue;

    const referenceDate = shipment.shippedAt || shipment.createdAt;
    const daysSinceLabel = differenceInCalendarDays(now, referenceDate);

    // Skip if already resolved/auto-resolved (don't re-create)
    const resolved = shipment.exceptions.filter((e) => e.status === "RESOLVED" || e.status === "AUTO_RESOLVED");
    if (resolved.length > 0) continue;

    const active = shipment.exceptions.filter((e) => e.status === "OPEN" || e.status === "INVESTIGATING");
    if (active.length > 0) {
      for (const ex of active) {
        if (ex.daysSinceLabel !== daysSinceLabel) {
          await prisma.orderException.update({
            where: { id: ex.id },
            data: { daysSinceLabel },
          });
        }
      }
      continue;
    }

    await prisma.$transaction([
      prisma.orderException.create({
        data: {
          orderId: shipment.order.id,
          shipmentId: shipment.id,
          type: "NO_MOVEMENT_AFTER_LABEL",
          severity: "HIGH",
          daysSinceLabel,
        },
      }),
      prisma.orderLog.create({
        data: {
          orderId: shipment.order.id,
          action: "exception_detected",
          toValue: "NO_MOVEMENT_AFTER_LABEL",
          message: `No movement: ${daysSinceLabel} days stuck in confirmed (tracking: ${shipment.trackingNumber})`,
          metadata: { type: "NO_MOVEMENT_AFTER_LABEL", shipmentId: shipment.id, daysSinceLabel },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}

/**
 * B. Long Transit — shipped > 7 business days ago, not yet delivered or failed.
 */
async function detectLongTransit(): Promise<number> {
  const now = new Date();

  const shipments = await prisma.shipment.findMany({
    where: {
      shippedAt: { not: null },
      status: { notIn: ["delivered", ...DELIVERY_FAILURE_STATUSES] },
      order: {
        internalStatus: { notIn: ["CANCELLED"] },
      },
    },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          shipments: { select: { id: true, status: true } },
        },
      },
      exceptions: {
        where: { type: "LONG_TRANSIT" },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    if (!shipment.shippedAt) continue;

    const hasDelivered = shipment.order.shipments.some(
      (s) => s.id !== shipment.id && s.status === "delivered"
    );
    if (hasDelivered) continue;

    const transitDays = differenceInBusinessDays(now, shipment.shippedAt);

    // Skip if already resolved (don't re-create)
    const resolved = shipment.exceptions.filter((e) => e.status === "RESOLVED" || e.status === "AUTO_RESOLVED");
    if (resolved.length > 0) continue;

    const active = shipment.exceptions.filter((e) => e.status === "OPEN" || e.status === "INVESTIGATING");
    if (active.length > 0) {
      for (const ex of active) {
        if (ex.transitDays !== transitDays) {
          await prisma.orderException.update({
            where: { id: ex.id },
            data: { transitDays },
          });
        }
      }
      continue;
    }

    if (transitDays <= EXCEPTION_THRESHOLDS.LONG_TRANSIT_BUSINESS_DAYS) continue;

    await prisma.$transaction([
      prisma.orderException.create({
        data: {
          orderId: shipment.order.id,
          shipmentId: shipment.id,
          type: "LONG_TRANSIT",
          severity: "MEDIUM",
          transitDays,
        },
      }),
      prisma.orderLog.create({
        data: {
          orderId: shipment.order.id,
          action: "exception_detected",
          toValue: "LONG_TRANSIT",
          message: `Long transit: ${transitDays} business days since shipped (tracking: ${shipment.trackingNumber})`,
          metadata: { type: "LONG_TRANSIT", shipmentId: shipment.id, transitDays },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}

/**
 * C. Delivery failed / exception status from carrier.
 */
async function detectDeliveryFailure(): Promise<number> {
  const shipments = await prisma.shipment.findMany({
    where: {
      status: { in: [...DELIVERY_FAILURE_STATUSES] },
      order: {
        internalStatus: { notIn: ["CANCELLED"] },
      },
    },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          shipments: { select: { id: true, status: true } },
        },
      },
      exceptions: {
        where: { type: "DELIVERY_FAILURE" },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    // Skip if any exception exists (active or resolved)
    if (shipment.exceptions.length > 0) continue;

    // Skip if another shipment on this order is already delivered
    const hasDelivered = shipment.order.shipments.some(
      (s) => s.id !== shipment.id && s.status === "delivered"
    );
    if (hasDelivered) continue;

    await prisma.$transaction([
      prisma.orderException.create({
        data: {
          orderId: shipment.order.id,
          shipmentId: shipment.id,
          type: "DELIVERY_FAILURE",
          severity: "HIGH",
        },
      }),
      prisma.orderLog.create({
        data: {
          orderId: shipment.order.id,
          action: "exception_detected",
          toValue: "DELIVERY_FAILURE",
          message: `Delivery failure detected (status: ${shipment.status}, tracking: ${shipment.trackingNumber})`,
          metadata: { type: "DELIVERY_FAILURE", shipmentId: shipment.id, status: shipment.status },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}

/**
 * D. Production Delay — order paid > 2 days ago but still has no tracking number.
 */
async function detectProductionDelay(): Promise<number> {
  const threshold = subDays(new Date(), EXCEPTION_THRESHOLDS.PRODUCTION_DELAY_DAYS);
  const now = new Date();

  const orders = await prisma.order.findMany({
    where: {
      shopifyStatus: "paid",
      shopifyCreatedAt: { lt: threshold },
      internalStatus: { notIn: ["CANCELLED"] },
      // No shipments with a tracking number
      shipments: {
        none: {
          trackingNumber: { not: null },
        },
      },
    },
    include: {
      exceptions: {
        where: { type: "PRODUCTION_DELAY" },
      },
    },
  });

  let detected = 0;
  for (const order of orders) {
    const hoursSincePaid = order.shopifyCreatedAt
      ? differenceInHours(now, order.shopifyCreatedAt)
      : 0;

    // Skip if already resolved (don't re-create)
    const resolved = order.exceptions.filter((e) => e.status === "RESOLVED" || e.status === "AUTO_RESOLVED");
    if (resolved.length > 0) continue;

    const active = order.exceptions.filter((e) => e.status === "OPEN" || e.status === "INVESTIGATING");
    if (active.length > 0) {
      for (const ex of active) {
        if (ex.hoursSincePaid !== hoursSincePaid) {
          await prisma.orderException.update({
            where: { id: ex.id },
            data: { hoursSincePaid },
          });
        }
      }
      continue;
    }

    await prisma.$transaction([
      prisma.orderException.create({
        data: {
          orderId: order.id,
          type: "PRODUCTION_DELAY",
          severity: "HIGH",
          hoursSincePaid,
        },
      }),
      prisma.orderLog.create({
        data: {
          orderId: order.id,
          action: "exception_detected",
          toValue: "PRODUCTION_DELAY",
          message: `Production delay: paid ${Math.floor(hoursSincePaid / 24)} days ago, no tracking number yet`,
          metadata: { type: "PRODUCTION_DELAY", hoursSincePaid, currentStatus: order.internalStatus },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}
