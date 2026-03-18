import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const addFileSchema = z.object({
  url: z.string().min(1),
  filename: z.string().min(1),
});

const deleteFileSchema = z.object({
  url: z.string().min(1),
});

type ExtraPrintFile = { url: string; filename: string };

function getExtraFiles(raw: unknown): ExtraPrintFile[] {
  if (Array.isArray(raw)) return raw as ExtraPrintFile[];
  return [];
}

/** POST — add an extra print file */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = addFileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { extraPrintFiles: true, printStatus: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const extras = getExtraFiles(order.extraPrintFiles);
  extras.push({ url: parsed.data.url, filename: parsed.data.filename });

  const updateData: Record<string, unknown> = {
    extraPrintFiles: JSON.parse(JSON.stringify(extras)),
  };
  if (order.printStatus === "NONE") {
    updateData.printStatus = "READY";
  }

  await prisma.order.update({ where: { id }, data: updateData });

  await prisma.orderLog.create({
    data: {
      orderId: id,
      userId: session.user?.id,
      action: "extra_file_added",
      toValue: parsed.data.filename,
      message: `Extra print file added: ${parsed.data.filename}`,
    },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

/** DELETE — remove an extra print file by url */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = deleteFileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { extraPrintFiles: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const extras = getExtraFiles(order.extraPrintFiles);
  const filtered = extras.filter((f) => f.url !== parsed.data.url);

  await prisma.order.update({
    where: { id },
    data: { extraPrintFiles: JSON.parse(JSON.stringify(filtered)) },
  });

  await prisma.orderLog.create({
    data: {
      orderId: id,
      userId: session.user?.id,
      action: "extra_file_deleted",
      fromValue: parsed.data.url,
      message: "Extra print file deleted",
    },
  });

  return NextResponse.json({ success: true });
}
