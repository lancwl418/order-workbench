import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().nullable().optional(),
  consoleUrl: z.string().url().nullable().optional(),
  secretKeyEnv: z.string().min(1).regex(/^[A-Z0-9_]+$/).optional(),
  platformType: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const supplier = await prisma.supplier.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ supplier });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const pushCount = await prisma.supplierPush.count({ where: { supplierId: id } });
  if (pushCount > 0) {
    return NextResponse.json(
      { error: `Supplier has ${pushCount} pushes — disable it instead of deleting` },
      { status: 400 }
    );
  }
  await prisma.supplier.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
