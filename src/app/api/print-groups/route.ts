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

  const where: Record<string, unknown> = {};
  if (statusParam) {
    const statuses = statusParam.split(",");
    where.status = { in: statuses };
  }

  const groups = await prisma.printGroup.findMany({
    where,
    include: {
      items: {
        include: {
          order: {
            select: {
              id: true,
              shopifyOrderNumber: true,
              customerName: true,
              internalStatus: true,
            },
          },
        },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(groups);
}
