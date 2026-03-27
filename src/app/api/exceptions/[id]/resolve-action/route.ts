import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createFullRefund } from "@/lib/shopify/refunds";
import { createReshipOrder } from "@/lib/shopify/draft-orders";

/**
 * POST /api/exceptions/:id/resolve-action
 *
 * Process a customer response: refund or reship via Shopify.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const exception = await prisma.orderException.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderNumber: true,
          customerName: true,
          totalPrice: true,
        },
      },
      response: {
        select: {
          responseType: true,
          respondedAt: true,
        },
      },
    },
  });

  if (!exception) {
    return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  }

  if (exception.status === "RESOLVED") {
    return NextResponse.json({ error: "Exception already resolved" }, { status: 400 });
  }

  if (!exception.response?.respondedAt) {
    return NextResponse.json({ error: "No customer response yet" }, { status: 400 });
  }

  if (!exception.order.shopifyOrderId) {
    return NextResponse.json({ error: "No Shopify order linked" }, { status: 400 });
  }

  const body = await req.json();
  const { action, shippingMethod, note } = body as {
    action: "REFUND" | "RESHIP";
    shippingMethod?: "express" | "standard";
    note?: string;
  };

  if (!action || !["REFUND", "RESHIP"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    if (action === "REFUND") {
      const result = await createFullRefund(exception.order.shopifyOrderId);

      await prisma.$transaction(async (tx) => {
        await tx.orderException.update({
          where: { id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: session.user?.id || "unknown",
          },
        });

        await tx.orderLog.create({
          data: {
            orderId: exception.orderId,
            userId: session.user?.id,
            action: "exception_refund_processed",
            message: `Refund processed for exception ${exception.type}`,
            metadata: {
              exceptionId: id,
              type: exception.type,
              refundId: result.refundId,
            },
          },
        });
      });

      return NextResponse.json({
        success: true,
        action: "REFUND",
        refundId: result.refundId,
      });
    }

    // RESHIP
    if (!shippingMethod || !["express", "standard"].includes(shippingMethod)) {
      return NextResponse.json({ error: "shippingMethod is required for reship" }, { status: 400 });
    }

    const result = await createReshipOrder({
      shopifyOrderId: exception.order.shopifyOrderId,
      shippingMethod,
      note,
    });

    await prisma.$transaction(async (tx) => {
      await tx.orderException.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: session.user?.id || "unknown",
        },
      });

      await tx.orderLog.create({
        data: {
          orderId: exception.orderId,
          userId: session.user?.id,
          action: "exception_reship_created",
          message: `Reship order ${result.orderName} created for exception ${exception.type}`,
          metadata: {
            exceptionId: id,
            type: exception.type,
            newShopifyOrderId: result.orderId,
            newOrderNumber: result.orderNumber,
            newOrderName: result.orderName,
            shippingMethod,
          },
        },
      });

      // Link new reship order to original if it already exists in DB
      if (result.orderId) {
        await tx.order.updateMany({
          where: { shopifyOrderId: result.orderId },
          data: { reshipForOrderId: exception.orderId },
        });
      }
    });

    return NextResponse.json({
      success: true,
      action: "RESHIP",
      newOrderName: result.orderName,
      newOrderNumber: result.orderNumber,
    });
  } catch (error) {
    console.error("Resolve action failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process action" },
      { status: 500 }
    );
  }
}
