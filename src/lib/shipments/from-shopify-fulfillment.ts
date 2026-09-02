import type { Shipment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { trackingsMatch } from "@/lib/suppliers/types";

export interface ShopifyFulfillmentShipmentInput {
  orderId: string;
  shopifyFulfillmentId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  /** Shopify shipment_status (in_transit, delivered, ...) or fulfillment status. */
  status: string;
  shippedAt: Date | null;
  /** Split group this fulfillment covers; null = whole order / unknown. */
  shopifyFulfillmentOrderId: string | null;
  deliveredAt?: Date;
}

/**
 * Persist a Shopify fulfillment as a shipment. Single write path for the
 * orders webhooks, the fulfillment webhooks and manual order sync.
 *
 * Match order:
 *  1. shipment already linked to this Shopify fulfillment id → update it
 *  2. an unlinked local shipment (OMS label / factory tracking) with the same
 *     tracking number → adopt it: link the fulfillment id and mark it synced.
 *     This is the case where the operator buys a label in OMS and then keys the
 *     same tracking into Shopify by hand before our sync runs — Shopify's
 *     webhook must not create a second row for the same parcel.
 *  3. otherwise create a new SHOPIFY-sourced shipment
 */
export async function upsertShipmentFromShopifyFulfillment(
  input: ShopifyFulfillmentShipmentInput
): Promise<Shipment> {
  const {
    orderId,
    shopifyFulfillmentId,
    trackingNumber,
    trackingUrl,
    carrier,
    status,
    shippedAt,
    shopifyFulfillmentOrderId,
    deliveredAt,
  } = input;

  const linked = await prisma.shipment.findUnique({ where: { shopifyFulfillmentId } });
  if (linked) {
    return prisma.shipment.update({
      where: { id: linked.id },
      data: {
        trackingNumber,
        trackingUrl,
        carrier,
        status,
        ...(shopifyFulfillmentOrderId ? { shopifyFulfillmentOrderId } : {}),
        ...(deliveredAt ? { deliveredAt } : {}),
      },
    });
  }

  const adoptable = trackingNumber
    ? await findUnlinkedShipmentByTracking(orderId, trackingNumber)
    : null;
  if (adoptable) {
    return prisma.shipment.update({
      where: { id: adoptable.id },
      data: {
        shopifyFulfillmentId,
        syncStatus: "SYNCED",
        syncError: null,
        labelStatus: "SYNCED_TO_SHOPIFY",
        status,
        // Keep the local (OMS/factory) carrier and tracking string — they are
        // the richer record; only fill blanks from Shopify.
        ...(adoptable.trackingUrl ? {} : { trackingUrl }),
        ...(adoptable.carrier ? {} : { carrier }),
        ...(adoptable.shippedAt ? {} : { shippedAt: shippedAt ?? new Date() }),
        ...(adoptable.shopifyFulfillmentOrderId || !shopifyFulfillmentOrderId
          ? {}
          : { shopifyFulfillmentOrderId }),
        ...(deliveredAt ? { deliveredAt } : {}),
      },
    });
  }

  return prisma.shipment.create({
    data: {
      orderId,
      sourceType: "SHOPIFY",
      trackingNumber,
      trackingUrl,
      carrier,
      shopifyFulfillmentId,
      syncStatus: "SYNCED",
      status,
      shippedAt,
      shopifyFulfillmentOrderId,
      ...(deliveredAt ? { deliveredAt } : {}),
    },
  });
}

/**
 * A shipment on this order that has no Shopify fulfillment yet and carries
 * the same tracking number (containment match — see trackingsMatch).
 */
export async function findUnlinkedShipmentByTracking(
  orderId: string,
  trackingNumber: string
): Promise<Shipment | null> {
  const candidates = await prisma.shipment.findMany({
    where: { orderId, shopifyFulfillmentId: null, trackingNumber: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  return candidates.find((sh) => trackingsMatch(sh.trackingNumber, trackingNumber)) ?? null;
}
