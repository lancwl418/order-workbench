import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pushFulfillmentToShopify } from "@/lib/shopify/fulfillments";
import { ensureBlanksSplit } from "@/lib/orders/blanks-split";
import { trackingsMatch } from "@/lib/suppliers/types";

/**
 * POST /api/fulfillment
 *
 * Push tracking information back to Shopify for a given shipment.
 * Takes a shipmentId, fetches the shipment and its order, calls the
 * Shopify API to create a fulfillment, and updates the label status
 * to SYNCED_TO_SHOPIFY.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { shipmentId } = body as { shipmentId: string };

    if (!shipmentId) {
      return NextResponse.json(
        { error: "shipmentId is required" },
        { status: 400 }
      );
    }

    // Fetch the shipment and its associated order
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          select: {
            id: true,
            shopifyOrderId: true,
            shopifyOrderNumber: true,
            orderItems: { select: { id: true, itemType: true, shopifyFulfillmentOrderId: true } },
            supplierPushes: { select: { itemIds: true, trackingNumber: true } },
          },
        },
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { error: "Shipment not found" },
        { status: 404 }
      );
    }

    if (!shipment.order.shopifyOrderId) {
      return NextResponse.json(
        { error: "Order has no associated Shopify order ID" },
        { status: 400 }
      );
    }

    if (!shipment.trackingNumber) {
      return NextResponse.json(
        { error: "Shipment has no tracking number" },
        { status: 400 }
      );
    }

    const carrier = "USPS";

    // A group-less shipment on a mixed order would fulfill EVERYTHING
    // (transfer + blanks) under one tracking. Split first and infer which
    // group this label belongs to.
    let fulfillmentOrderId = shipment.shopifyFulfillmentOrderId ?? undefined;
    const items = shipment.order.orderItems;
    const isMixed =
      items.some((i) => i.itemType === "other") && items.some((i) => i.itemType !== "other");
    if (!fulfillmentOrderId && isMixed) {
      const split = await ensureBlanksSplit(shipment.order.id, session.user?.id);
      if (split.error) {
        return NextResponse.json(
          { error: `Order is mixed and could not be split: ${split.error}` },
          { status: 400 }
        );
      }
      const freshItems = await prisma.orderItem.findMany({
        where: { orderId: shipment.order.id },
        select: { id: true, itemType: true, shopifyFulfillmentOrderId: true },
      });
      // Blanks label? Its tracking matches a supplier push -> that push's group.
      const matchingPush = shipment.order.supplierPushes.find((p) =>
        trackingsMatch(p.trackingNumber, shipment.trackingNumber)
      );
      if (matchingPush) {
        fulfillmentOrderId =
          freshItems.find(
            (i) => matchingPush.itemIds.includes(i.id) && i.shopifyFulfillmentOrderId
          )?.shopifyFulfillmentOrderId ?? undefined;
      } else {
        // Otherwise assume it's the non-blanks (transfer) label — only when
        // that resolves to exactly one group.
        const nonBlankFos = [
          ...new Set(
            freshItems
              .filter((i) => i.itemType !== "other" && i.shopifyFulfillmentOrderId)
              .map((i) => i.shopifyFulfillmentOrderId as string)
          ),
        ];
        if (nonBlankFos.length === 1) fulfillmentOrderId = nonBlankFos[0];
      }
      if (!fulfillmentOrderId) {
        return NextResponse.json(
          { error: "Cannot tell which fulfillment group this label covers — recreate the label for a specific group" },
          { status: 400 }
        );
      }
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { shopifyFulfillmentOrderId: fulfillmentOrderId },
      });
    }

    // Push fulfillment to Shopify
    const result = await pushFulfillmentToShopify({
      shopifyOrderId: shipment.order.shopifyOrderId,
      trackingNumber: shipment.trackingNumber,
      carrier,
      fulfillmentOrderId,
    });

    // Update shipment with Shopify fulfillment info
    await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        shopifyFulfillmentId: result.fulfillmentId,
        syncStatus: "SYNCED",
        labelStatus: "SYNCED_TO_SHOPIFY",
        status: "shipped",
        shippedAt: new Date(),
      },
    });

    // Update the order's label status and fulfillment pushed timestamp
    await prisma.order.update({
      where: { id: shipment.order.id },
      data: {
        labelStatus: "SYNCED_TO_SHOPIFY",
        fulfillmentPushedAt: new Date(),
        trackingNumber: shipment.trackingNumber,
        carrier: shipment.carrier,
      },
    });

    // Log the fulfillment push
    await prisma.orderLog.create({
      data: {
        orderId: shipment.order.id,
        userId: session.user?.id,
        action: "fulfillment_pushed",
        toValue: result.fulfillmentId,
        message: `Fulfillment pushed to Shopify for order ${shipment.order.shopifyOrderNumber} (tracking: ${shipment.trackingNumber}, carrier: ${shipment.carrier})`,
        metadata: {
          shipmentId: shipment.id,
          shopifyFulfillmentId: result.fulfillmentId,
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.carrier,
        },
      },
    });

    return NextResponse.json({
      success: true,
      fulfillmentId: result.fulfillmentId,
      status: result.status,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error("Fulfillment push failed:", errorMessage);

    // If we have a shipmentId, update the sync status to failed
    try {
      const body = await req.clone().json().catch(() => ({}));
      const { shipmentId } = body as { shipmentId?: string };
      if (shipmentId) {
        await prisma.shipment.update({
          where: { id: shipmentId },
          data: {
            syncStatus: "FAILED",
            syncError: errorMessage,
          },
        });
      }
    } catch {
      // Ignore secondary errors during error handling
    }

    return NextResponse.json(
      { error: "Fulfillment push failed", details: errorMessage },
      { status: 500 }
    );
  }
}
