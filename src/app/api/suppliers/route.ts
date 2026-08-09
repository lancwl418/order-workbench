import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { vendorMappings: true, pushes: true } } },
  });
  // Report whether each supplier's secret env var is configured (never the value)
  return NextResponse.json({
    suppliers: suppliers.map((s) => ({
      ...s,
      secretConfigured: !!process.env[s.secretKeyEnv],
    })),
  });
}

const createSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/, "lowercase letters, digits, - and _ only"),
  name: z.string().min(1),
  adapterType: z.enum(["linmiao", "riin"]),
  baseUrl: z.string().url().optional().nullable(),
  secretKeyEnv: z.string().min(1).regex(/^[A-Z0-9_]+$/, "env var name (A-Z, 0-9, _)"),
  platformType: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.supplier.findUnique({ where: { key: parsed.data.key } });
  if (existing) {
    return NextResponse.json({ error: `Supplier "${parsed.data.key}" already exists` }, { status: 409 });
  }

  const supplier = await prisma.supplier.create({
    data: {
      key: parsed.data.key,
      name: parsed.data.name,
      adapterType: parsed.data.adapterType,
      baseUrl: parsed.data.baseUrl ?? null,
      secretKeyEnv: parsed.data.secretKeyEnv,
      platformType: parsed.data.platformType ?? 15,
      enabled: parsed.data.enabled ?? true,
    },
  });
  return NextResponse.json({ supplier }, { status: 201 });
}
