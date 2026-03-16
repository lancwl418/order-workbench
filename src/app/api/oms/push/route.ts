import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOrder } from "@/lib/eccangtms/client";
import { mapOrderToEccangParams } from "@/lib/eccangtms/mapper";
import { z } from "zod";

const pushSchema = z.object({
  orderId: z.string(),
  productCode: z.string().min(1),
  packageInfo: z.object({
    weightLbs: z.number().positive(),
    lengthIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
  }),
});

/**
 * POST /api/oms/push
 * Push an order to EccangTMS to create a shipping label.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { orderId, productCode, packageInfo } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true, shipments: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!order.shippingAddress) {
    return NextResponse.json(
      { error: "Order has no shipping address" },
      { status: 400 }
    );
  }

  // Check if already pushed to OMS
  const existingOms = order.shipments.find(
    (s) => s.providerName === "eccangtms"
  );
  if (existingOms) {
    return NextResponse.json(
      {
        error: "Order already pushed to OMS",
        shipment: existingOms,
      },
      { status: 409 }
    );
  }

  try {
    const params = mapOrderToEccangParams(order, productCode, packageInfo);
    const result = await createOrder(params);

    // serverNo may be null at creation time — EccangTMS assigns it asynchronously
    const serverNo = result.serverNo || null;

    // Create shipment record
    const shipment = await prisma.shipment.create({
      data: {
        orderId,
        sourceType: "THIRD_PARTY",
        trackingNumber: serverNo,
        carrier: result.productName || productCode,
        service: result.productCode,
        shippingCost: result.totalPrice,
        externalShipmentId: result.orderNo,
        providerName: "eccangtms",
        providerRawJson: JSON.parse(JSON.stringify(result)),
        labelStatus: "CREATED",
        status: result.status === 1 ? "label_created" : "pending",
      },
    });

    // Update order denormalized fields
    await prisma.order.update({
      where: { id: orderId },
      data: {
        ...(serverNo ? { trackingNumber: serverNo } : {}),
        carrier: result.productName || productCode,
        shippingRoute: "THIRD_PARTY",
        labelStatus: "CREATED",
        internalStatus: "LABEL_CREATED",
      },
    });

    // Audit log
    await prisma.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "oms_order_created",
        message: `Pushed to OMS: ${result.productName} | Server: ${result.serverNo} | Cost: $${result.totalPrice}`,
        toValue: result.orderNo,
        metadata: {
          productCode: result.productCode,
          productName: result.productName,
          serverNo: result.serverNo,
          orderNo: result.orderNo,
          totalPrice: result.totalPrice,
        },
      },
    });

    return NextResponse.json({
      success: true,
      shipment,
      omsOrder: {
        orderNo: result.orderNo,
        serverNo: result.serverNo,
        productName: result.productName,
        totalPrice: result.totalPrice,
        status: result.status,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to push to OMS";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
