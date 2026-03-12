import { prisma } from "@/lib/prisma";
import { differenceInCalendarDays, differenceInHours, subDays, subHours } from "date-fns";
import { differenceInBusinessDays } from "./business-days";
import { autoResolveExceptions } from "./resolver";
import {
  EXCEPTION_THRESHOLDS,
  DELIVERY_FAILURE_STATUSES,
  PRODUCTION_COMPLETE_STATUSES,
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
 * A. Tracking created but no movement after 2 calendar days.
 */
async function detectNoMovementAfterLabel(): Promise<number> {
  const threshold = subDays(new Date(), EXCEPTION_THRESHOLDS.NO_MOVEMENT_DAYS);
  const now = new Date();

  const shipments = await prisma.shipment.findMany({
    where: {
      trackingNumber: { not: null },
      createdAt: { lt: threshold },
      status: { notIn: ["delivered", "in_transit", "out_for_delivery"] },
      order: {
        internalStatus: { notIn: ["SHIPPED", "CANCELLED"] },
      },
    },
    include: {
      order: { select: { id: true, shopifyOrderNumber: true } },
      exceptions: {
        where: {
          type: "NO_MOVEMENT_AFTER_LABEL",
          status: { in: ["OPEN", "INVESTIGATING"] },
        },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    if (shipment.exceptions.length > 0) continue;

    const daysSinceLabel = differenceInCalendarDays(now, shipment.createdAt);

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
          message: `No tracking movement ${daysSinceLabel} days after label created (tracking: ${shipment.trackingNumber})`,
          metadata: { type: "NO_MOVEMENT_AFTER_LABEL", shipmentId: shipment.id, daysSinceLabel },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}

/**
 * B. Tracking stuck in transit > 8 business days.
 */
async function detectLongTransit(): Promise<number> {
  const now = new Date();

  const shipments = await prisma.shipment.findMany({
    where: {
      status: { in: ["in_transit", "confirmed"] },
      shippedAt: { not: null },
      order: {
        internalStatus: { notIn: ["CANCELLED"] },
      },
    },
    include: {
      order: { select: { id: true, shopifyOrderNumber: true } },
      exceptions: {
        where: {
          type: "LONG_TRANSIT",
          status: { in: ["OPEN", "INVESTIGATING"] },
        },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    if (shipment.exceptions.length > 0) continue;
    if (!shipment.shippedAt) continue;

    const transitDays = differenceInBusinessDays(now, shipment.shippedAt);
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
          message: `Shipment in transit for ${transitDays} business days (tracking: ${shipment.trackingNumber})`,
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
      order: { select: { id: true, shopifyOrderNumber: true } },
      exceptions: {
        where: {
          type: "DELIVERY_FAILURE",
          status: { in: ["OPEN", "INVESTIGATING"] },
        },
      },
    },
  });

  let detected = 0;
  for (const shipment of shipments) {
    if (shipment.exceptions.length > 0) continue;

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
 * D. Order paid > 48 hours ago but not yet printed/shipped.
 */
async function detectProductionDelay(): Promise<number> {
  const threshold = subHours(new Date(), EXCEPTION_THRESHOLDS.PRODUCTION_DELAY_HOURS);
  const now = new Date();

  const orders = await prisma.order.findMany({
    where: {
      shopifyStatus: "paid",
      shopifyCreatedAt: { lt: threshold },
      internalStatus: { notIn: [...PRODUCTION_COMPLETE_STATUSES] },
    },
    include: {
      exceptions: {
        where: {
          type: "PRODUCTION_DELAY",
          status: { in: ["OPEN", "INVESTIGATING"] },
        },
      },
    },
  });

  let detected = 0;
  for (const order of orders) {
    if (order.exceptions.length > 0) continue;

    const hoursSincePaid = order.shopifyCreatedAt
      ? differenceInHours(now, order.shopifyCreatedAt)
      : 0;

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
          message: `Production delay: order paid ${hoursSincePaid}h ago, still in ${order.internalStatus} status`,
          metadata: { type: "PRODUCTION_DELAY", hoursSincePaid, currentStatus: order.internalStatus },
        },
      }),
    ]);
    detected++;
  }

  return detected;
}
