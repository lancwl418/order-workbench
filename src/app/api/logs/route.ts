import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json(
      { error: "orderId parameter is required" },
      { status: 400 }
    );
  }

  const logs = await prisma.orderLog.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { displayName: true, username: true } },
    },
  });

  return NextResponse.json(logs);
}
