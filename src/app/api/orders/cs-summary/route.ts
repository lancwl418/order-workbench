import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await prisma.order.findMany({
    where: { csFlag: true },
    orderBy: [{ csPriority: "desc" }, { shopifyCreatedAt: "desc" }],
    select: {
      id: true,
      shopifyOrderNumber: true,
      customerName: true,
      csPriority: true,
      csIssueType: true,
      csNote: true,
      internalStatus: true,
      csComments: {
        orderBy: { createdAt: "desc" },
        take: 3,
        include: {
          user: { select: { displayName: true, username: true } },
        },
      },
    },
  });

  return NextResponse.json(orders);
}
