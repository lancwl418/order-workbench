import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { giftOrderUpdateSchema } from "@/lib/validators";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = giftOrderUpdateSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid gift order data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { shippingAddress, ...customer } = parsed.data;
  const result = await prisma.giftOrder.updateMany({
    where: { id, status: { in: ["READY", "FAILED"] } },
    data: {
      ...customer,
      shippingAddress: JSON.parse(JSON.stringify(shippingAddress)),
      status: "READY",
      errorMessage: null,
    },
  });

  if (result.count === 0) {
    const exists = await prisma.giftOrder.findUnique({
      where: { id },
      select: { id: true },
    });
    return NextResponse.json(
      {
        error: exists
          ? "Orders already sent to OMS cannot be edited"
          : "Gift order not found",
      },
      { status: exists ? 409 : 404 }
    );
  }

  const order = await prisma.giftOrder.findUnique({ where: { id } });
  return NextResponse.json(order);
}
