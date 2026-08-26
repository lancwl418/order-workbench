import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncPushTrackingToShopify } from "@/lib/suppliers/push-service";

/** POST — sync this push's factory tracking back to Shopify (manual backup
 * for the automatic sync that runs when tracking is captured). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await syncPushTrackingToShopify(id, session.user?.id);
  if (!result.synced) {
    return NextResponse.json({ error: result.error ?? "Sync failed" }, { status: 400 });
  }
  return NextResponse.json({ synced: true });
}
