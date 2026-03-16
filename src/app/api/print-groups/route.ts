import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");

  const where: Record<string, unknown> = {};
  if (statusParam) {
    const statuses = statusParam.split(",");
    where.status = { in: statuses };
  }

  const include = {
    items: {
      include: {
        order: {
          select: {
            id: true,
            shopifyOrderNumber: true,
            customerName: true,
            internalStatus: true,
            printStatus: true,
            orderItems: {
              select: {
                id: true,
                title: true,
                variantTitle: true,
                designFileUrl: true,
                originalDesignFileUrl: true,
                isPrinted: true,
              },
            },
          },
        },
      },
      orderBy: { position: "asc" as const },
    },
  };

  // Paginated response when page param is present
  if (pageParam) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || "20", 10)));
    const skip = (page - 1) * limit;

    const [groups, total] = await Promise.all([
      prisma.printGroup.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.printGroup.count({ where }),
    ]);

    return NextResponse.json({ groups, total, page, limit });
  }

  // Default: return all (existing behavior)
  const groups = await prisma.printGroup.findMany({
    where,
    include,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(groups);
}
