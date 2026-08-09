import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pushPlacedSupplierPush } from "@/lib/suppliers/push-service";

/** POST — push an already-placed supplier order to the factory. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { push, error, status } = await pushPlacedSupplierPush(id, session.user?.id);
  if (error) {
    return NextResponse.json({ error, push }, { status: status ?? 400 });
  }
  return NextResponse.json({ push });
}
