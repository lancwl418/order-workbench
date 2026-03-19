import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateShipping } from "@/lib/eccangtms/client";
import { mapOrderToEccangParams } from "@/lib/eccangtms/mapper";
import { z } from "zod";
import { addressOverrideSchema } from "@/lib/validators";

const estimateSchema = z.object({
  orderId: z.string(),
  packageInfo: z.object({
    weightLbs: z.number().positive(),
    lengthIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
  }),
  addressOverride: addressOverrideSchema.optional(),
});

/**
 * POST /api/oms/estimate
 * Estimate shipping costs across all available products.
 * Returns results sorted by totalPrice ascending (cheapest first).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = estimateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderId, packageInfo, addressOverride } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!order.shippingAddress && !addressOverride) {
    return NextResponse.json(
      { error: "Order has no shipping address" },
      { status: 400 }
    );
  }

  // Apply address override if provided
  const orderWithAddress = addressOverride
    ? { ...order, shippingAddress: { ...(order.shippingAddress as Record<string, unknown> || {}), ...addressOverride } }
    : order;

  try {
    // Use empty productCode to estimate across all products
    const params = mapOrderToEccangParams(orderWithAddress as typeof order, "", packageInfo);
    // Remove productCode so API returns all products
    const { productCode: _, ...paramsWithoutProduct } = params;
    const estimates = await calculateShipping(paramsWithoutProduct as typeof params);

    // Sort by totalPrice ascending (cheapest first)
    const sorted = [...estimates].sort((a, b) => a.totalPrice - b.totalPrice);

    return NextResponse.json(sorted);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to estimate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
