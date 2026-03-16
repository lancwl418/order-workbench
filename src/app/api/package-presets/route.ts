import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  weightLbs: z.number().positive(),
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  isDefault: z.boolean().optional(),
});

/** GET /api/package-presets — List all presets */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const presets = await prisma.packagePreset.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(presets);
}

/** POST /api/package-presets — Create a new preset */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // If setting as default, unset other defaults
  if (parsed.data.isDefault) {
    await prisma.packagePreset.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  const preset = await prisma.packagePreset.create({
    data: parsed.data,
  });

  return NextResponse.json(preset, { status: 201 });
}

/** DELETE /api/package-presets?id=xxx — Delete a preset */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await prisma.packagePreset.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
