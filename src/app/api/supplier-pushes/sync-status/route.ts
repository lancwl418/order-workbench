import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncSupplierStatuses } from "@/lib/suppliers/push-service";

/**
 * POST — manually refresh supplier order statuses. Optional body
 * { orderId } limits the sync to one order (detail-page refresh button).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let orderId: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.orderId === "string") orderId = body.orderId;
  } catch {
    // empty body → sync everything
  }

  const result = await syncSupplierStatuses({ orderId });
  return NextResponse.json(result);
}
