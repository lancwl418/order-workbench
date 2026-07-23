import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { giftCustomerSchema } from "@/lib/validators";
import { z } from "zod";

const importSchema = z.object({
  customers: z.array(giftCustomerSchema).min(1).max(5000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = importSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid customer data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const segment = await prisma.giftSegment.findUnique({ where: { id } });
  if (!segment) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const customers = parsed.data.customers.map((customer) => {
    const address = customer.shippingAddress;
    const customerName =
      customer.customerName?.trim() ||
      `${address.first_name} ${address.last_name}`.trim();

    return {
      segmentId: id,
      customerExternalId: customer.customerExternalId,
      customerName,
      customerEmail: customer.customerEmail || null,
      customerPhone: customer.customerPhone || address.phone || null,
      shippingAddress: JSON.parse(JSON.stringify(address)),
    };
  });

  if (customers.some((customer) => !customer.customerName)) {
    return NextResponse.json(
      { error: "Every customer needs a name or first/last name" },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.giftOrder.createMany({
      data: customers,
      skipDuplicates: true,
    });

    return NextResponse.json({
      success: true,
      created: result.count,
      skipped: customers.length - result.count,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to import customers";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
