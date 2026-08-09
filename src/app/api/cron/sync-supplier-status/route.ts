import { NextRequest, NextResponse } from "next/server";
import { syncSupplierStatuses } from "@/lib/suppliers/push-service";

/**
 * POST/GET /api/cron/sync-supplier-status
 *
 * Protected by CRON_SECRET bearer token. Called by a Render Cron Job to keep
 * supplier order statuses fresh (catches factory rejections, 反审回电商).
 */
async function handler(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const result = await syncSupplierStatuses();
  const durationMs = Date.now() - startTime;

  return NextResponse.json({
    success: true,
    ...result,
    durationMs,
    timestamp: new Date().toISOString(),
  });
}

export const GET = handler;
export const POST = handler;
