import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { purchaseOrderQuerySchema, purchaseOrderCreateSchema } from "@/lib/validators";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams;
  const parsed = purchaseOrderQuerySchema.safeParse(Object.fromEntries(url));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
  }

  const { page, limit, status, search, sort, dir } = parsed.data;

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { poNumber: { contains: search, mode: "insensitive" } },
      { supplier: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput = {
    [sort]: dir,
  };

  const [data, total] = await prisma.$transaction([
    prisma.purchaseOrder.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = purchaseOrderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
  }

  const { poNumber, supplier, amount, currency, purchaseDate, note, attachments } = parsed.data;

  const existing = await prisma.purchaseOrder.findUnique({ where: { poNumber } });
  if (existing) {
    return NextResponse.json({ error: "PO number already exists" }, { status: 409 });
  }

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplier,
      amount,
      currency,
      purchaseDate: new Date(purchaseDate),
      note: note ?? null,
      attachments: attachments ?? [],
    },
  });

  return NextResponse.json(po, { status: 201 });
}
