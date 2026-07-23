import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateShipping } from "@/lib/eccangtms/client";
import { mapGiftOrderToEccangParams } from "@/lib/eccangtms/mapper";
import { giftPackageSchema } from "@/lib/validators";
import { z } from "zod";

export const maxDuration = 300;

const estimateSchema = z.object({
  orderIds: z.array(z.string()).min(1).max(500),
  packageInfo: giftPackageSchema,
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
  const parsed = estimateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid estimate request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const segment = await prisma.giftSegment.findUnique({
    where: { id },
    include: {
      orders: {
        where: {
          id: { in: parsed.data.orderIds },
          status: { not: "PUSHED" },
        },
      },
    },
  });

  if (!segment) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const orderById = new Map(segment.orders.map((order) => [order.id, order]));
  const orders = parsed.data.orderIds
    .map((orderId) => orderById.get(orderId))
    .filter((order) => order !== undefined);
  const pricedSegment = { ...segment, ...parsed.data.packageInfo };
  let cursor = 0;
  const quotes: Array<{
    orderId: string;
    success: boolean;
    estimates?: Array<{
      productCode: string;
      productName: string;
      productNameLang2?: string;
      totalPrice: number;
      currencyCode: string;
      effectiveTime: string;
      chargedWeight: number;
      remoteFlag: boolean;
    }>;
    error?: string;
  }> = [];

  async function estimateNext() {
    while (cursor < orders.length) {
      const order = orders[cursor++];
      try {
        const params = mapGiftOrderToEccangParams(order, pricedSegment, "");
        const { productCode: _productCode, ...paramsWithoutProduct } = params;
        void _productCode;
        const estimates = await calculateShipping(
          paramsWithoutProduct as typeof params
        );
        const sorted = estimates
          .filter(
            (estimate) =>
              Number.isFinite(estimate.totalPrice) && estimate.totalPrice >= 0
          )
          .sort((a, b) => a.totalPrice - b.totalPrice)
          .map((estimate) => ({
            productCode: estimate.productCode,
            productName: estimate.productName,
            productNameLang2: estimate.productNameLang2,
            totalPrice: estimate.totalPrice,
            currencyCode: estimate.currencyCode,
            effectiveTime: estimate.effectiveTime,
            chargedWeight: estimate.chargedWeight,
            remoteFlag: estimate.remoteFlag,
          }));

        if (!sorted.length) {
          throw new Error("OMS returned no available shipping service");
        }
        quotes.push({ orderId: order.id, success: true, estimates: sorted });
      } catch (error) {
        quotes.push({
          orderId: order.id,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to estimate shipping",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, orders.length) }, () => estimateNext())
  );

  const quoteById = new Map(quotes.map((quote) => [quote.orderId, quote]));
  return NextResponse.json({
    quotes: parsed.data.orderIds
      .map((orderId) => quoteById.get(orderId))
      .filter((quote) => quote !== undefined),
    skipped: parsed.data.orderIds.length - orders.length,
  });
}
