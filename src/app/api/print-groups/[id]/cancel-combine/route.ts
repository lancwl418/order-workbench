import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { abortCombine } from "@/lib/download-progress";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.printGroup.findUnique({ where: { id } });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Abort the in-memory job
  abortCombine(id);

  // Reset DB status regardless (handles stale PROCESSING state too)
  await prisma.printGroup.update({
    where: { id },
    data: {
      downloadStatus: null,
      downloadProgress: 0,
      downloadError: null,
      downloadStartedAt: null,
    },
  });

  return NextResponse.json({ success: true });
}
