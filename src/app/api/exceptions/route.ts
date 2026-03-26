import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exceptionQuerySchema } from "@/lib/validators";
import type { Prisma } from "@prisma/client";

/**
 * GET /api/exceptions
 *
 * List exceptions with filtering and pagination.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = exceptionQuerySchema.safeParse(searchParams);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const params = parsed.data;
  const where: Prisma.OrderExceptionWhereInput = {};

  // Filter by status (default to OPEN + INVESTIGATING if not specified)
  if (params.status) {
    where.status = params.status;
  } else {
    where.status = { in: ["OPEN", "INVESTIGATING"] };
  }

  if (params.type) {
    where.type = params.type;
  }

  if (params.severity) {
    where.severity = params.severity;
  }

  if (params.orderId) {
    where.orderId = params.orderId;
  }

  // Category filter
  if (params.category === "shipment") {
    where.type = { in: ["NO_MOVEMENT_AFTER_LABEL", "LONG_TRANSIT", "DELIVERY_FAILURE"] };
  } else if (params.category === "processing") {
    where.type = "PRODUCTION_DELAY";
  }

  const skip = (params.page - 1) * params.limit;

  const [exceptions, total] = await prisma.$transaction([
    prisma.orderException.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip,
      take: params.limit,
      include: {
        order: {
          select: {
            id: true,
            shopifyOrderNumber: true,
            customerName: true,
            customerEmail: true,
            internalStatus: true,
            trackingNumber: true,
          },
        },
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            carrier: true,
            status: true,
            shippedAt: true,
            createdAt: true,
          },
        },
        response: {
          select: {
            responseType: true,
            needByDate: true,
            noRush: true,
            comments: true,
            respondedAt: true,
          },
        },
      },
    }),
    prisma.orderException.count({ where }),
  ]);

  return NextResponse.json({
    data: exceptions,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  });
}
