import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderQuerySchema } from "@/lib/validators";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = orderQuerySchema.safeParse(searchParams);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const params = parsed.data;
  const where = buildWhereClause(params);

  const validSortFields = [
    "createdAt",
    "shopifyCreatedAt",
    "shopifyOrderNumber",
    "customerName",
    "internalStatus",
    "priority",
    "totalPrice",
  ];
  const sortField = validSortFields.includes(params.sort)
    ? params.sort
    : "createdAt";

  const skip = (params.page - 1) * params.limit;

  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: { [sortField]: params.dir },
      skip,
      take: params.limit,
      include: {
        orderItems: true,
        shipments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, carrier: true, trackingNumber: true, trackingUrl: true },
        },
        _count: { select: { shipments: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({
    data: orders,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  });
}

function buildWhereClause(
  params: ReturnType<typeof orderQuerySchema.parse>
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  // View presets
  switch (params.view) {
    case "print-queue":
      where.internalStatus = { in: ["READY_TO_PRINT", "PRINTING"] };
      break;
    case "cs-queue":
      where.csFlag = true;
      break;
    case "exceptions":
      where.OR = [
        { isOverdue: true },
        { internalStatus: "ON_HOLD" },
        { internalStatus: "DELAYED" },
        { delayFlag: true },
      ];
      break;
  }

  // Additional filters (can narrow down within a view)
  if (params.status && params.view === "all") {
    where.internalStatus = params.status;
  }

  if (params.shippingRoute) {
    where.shippingRoute = params.shippingRoute;
  }

  if (params.labelStatus) {
    where.labelStatus = params.labelStatus;
  }

  if (params.delayFlag !== undefined) {
    where.delayFlag = params.delayFlag;
  }

  if (params.csFlag !== undefined && params.view !== "cs-queue") {
    where.csFlag = params.csFlag;
  }

  if (params.search) {
    where.OR = [
      ...(where.OR ? (where.OR as Prisma.OrderWhereInput[]) : []),
      { shopifyOrderNumber: { contains: params.search, mode: "insensitive" } },
      { customerName: { contains: params.search, mode: "insensitive" } },
      { customerEmail: { contains: params.search, mode: "insensitive" } },
      { trackingNumber: { contains: params.search, mode: "insensitive" } },
    ];
  }

  return where;
}
