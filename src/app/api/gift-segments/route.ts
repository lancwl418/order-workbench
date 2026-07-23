import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { giftSegmentSchema } from "@/lib/validators";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const segments = await prisma.giftSegment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { orders: true } },
    },
  });

  return NextResponse.json(segments);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = giftSegmentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid segment data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const segment = await prisma.giftSegment.create({
    data: parsed.data,
    include: {
      orders: true,
      _count: { select: { orders: true } },
    },
  });

  return NextResponse.json(segment, { status: 201 });
}
