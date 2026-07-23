import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { giftSegmentSchema } from "@/lib/validators";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const segment = await prisma.giftSegment.findUnique({
    where: { id },
    include: {
      orders: { orderBy: { createdAt: "desc" } },
      _count: { select: { orders: true } },
    },
  });

  if (!segment) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  return NextResponse.json(segment);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = giftSegmentSchema.partial().safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid segment data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.giftSegment.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const segment = await prisma.giftSegment.update({
    where: { id },
    data: parsed.data,
    include: {
      orders: { orderBy: { createdAt: "desc" } },
      _count: { select: { orders: true } },
    },
  });

  return NextResponse.json(segment);
}
