import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDownloadProgress } from "@/lib/download-progress";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const progress = getDownloadProgress(id);

  if (!progress) {
    return NextResponse.json({ progress: -1 });
  }

  return NextResponse.json(progress);
}
