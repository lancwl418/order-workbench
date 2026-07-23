import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  calculateShipping,
  createOrder,
  getTrackingNumber,
} from "@/lib/eccangtms/client";
import { mapGiftOrderToEccangParams } from "@/lib/eccangtms/mapper";
import { giftPackageSchema } from "@/lib/validators";
import { z } from "zod";

export const maxDuration = 300;

const pushSchema = z.object({
  orderIds: z.array(z.string()).min(1).max(500).optional(),
  orders: z
    .array(
      z.object({
        orderId: z.string(),
        productCode: z.string().min(1),
      })
    )
    .min(1)
    .max(500)
    .optional(),
  packageInfo: giftPackageSchema.optional(),
  savePackageInfo: z.boolean().default(false),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const requestedOrderIds =
    parsed.data.orders?.map((order) => order.orderId) ??
    parsed.data.orderIds;
  const selectedProductByOrder = new Map(
    parsed.data.orders?.map((order) => [order.orderId, order.productCode]) ?? []
  );

  const segment = await prisma.giftSegment.findUnique({
    where: { id },
    include: {
      orders: {
        where: {
          status: { not: "PUSHED" },
          ...(requestedOrderIds
            ? { id: { in: requestedOrderIds } }
            : {}),
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!segment) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const giftSegment = {
    ...segment,
    ...(parsed.data.packageInfo ?? {}),
  };

  if (parsed.data.packageInfo && parsed.data.savePackageInfo) {
    await prisma.giftSegment.update({
      where: { id },
      data: parsed.data.packageInfo,
    });
  }

  if (giftSegment.orders.length === 0) {
    return NextResponse.json({
      success: true,
      total: 0,
      pushed: 0,
      failed: 0,
      results: [],
    });
  }

  let cursor = 0;
  const results: Array<{
    orderId: string;
    success: boolean;
    service?: string;
    cost?: number;
    error?: string;
  }> = [];

  async function pushNext() {
    while (cursor < giftSegment.orders.length) {
      const order = giftSegment.orders[cursor++];

      try {
        await prisma.giftOrder.update({
          where: { id: order.id },
          data: { status: "PUSHING", errorMessage: null },
        });

        let productCode = selectedProductByOrder.get(order.id);
        let estimatedProductName: string | undefined;

        if (!productCode) {
          const estimateParams = mapGiftOrderToEccangParams(
            order,
            giftSegment,
            ""
          );
          const { productCode: _productCode, ...paramsWithoutProduct } =
            estimateParams;
          void _productCode;
          const estimates = await calculateShipping(
            paramsWithoutProduct as typeof estimateParams
          );
          const cheapest = estimates
            .filter(
              (estimate) =>
                Number.isFinite(estimate.totalPrice) &&
                estimate.totalPrice >= 0
            )
            .sort((a, b) => a.totalPrice - b.totalPrice)[0];

          if (!cheapest) {
            throw new Error("OMS returned no available shipping service");
          }
          productCode = cheapest.productCode;
          estimatedProductName = cheapest.productName;
        }

        const createParams = mapGiftOrderToEccangParams(
          order,
          giftSegment,
          productCode
        );
        const omsOrder = await createOrder(createParams);
        let trackingNumber = omsOrder.serverNo || null;

        if (!trackingNumber && omsOrder.orderNo) {
          try {
            const tracking = await getTrackingNumber(omsOrder.orderNo);
            trackingNumber = tracking?.[0]?.serverNo || null;
          } catch {
            // Tracking may be assigned asynchronously and can be refreshed later.
          }
        }

        await prisma.giftOrder.update({
          where: { id: order.id },
          data: {
            status: "PUSHED",
            errorMessage: null,
            omsOrderNo: omsOrder.orderNo,
            trackingNumber,
            carrier: omsOrder.productName || estimatedProductName || productCode,
            service: omsOrder.productCode || productCode,
            shippingCost: omsOrder.totalPrice,
            omsRawJson: JSON.parse(JSON.stringify(omsOrder)),
            pushedAt: new Date(),
          },
        });

        results.push({
          orderId: order.id,
          success: true,
          service: omsOrder.productName || estimatedProductName || productCode,
          cost: omsOrder.totalPrice,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to push to OMS";
        await prisma.giftOrder.update({
          where: { id: order.id },
          data: { status: "FAILED", errorMessage: message },
        });
        results.push({ orderId: order.id, success: false, error: message });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(3, giftSegment.orders.length) },
      () => pushNext()
    )
  );

  const pushed = results.filter((result) => result.success).length;

  return NextResponse.json({
    success: pushed === results.length,
    total: results.length,
    pushed,
    failed: results.length - pushed,
    results,
  });
}
