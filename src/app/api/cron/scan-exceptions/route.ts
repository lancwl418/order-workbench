import { NextRequest, NextResponse } from "next/server";
import { scanAllExceptions } from "@/lib/exceptions/detector";

/**
 * POST/GET /api/cron/scan-exceptions
 *
 * Protected by CRON_SECRET bearer token.
 * Called by Vercel cron or external cron every 1 hour.
 */
async function handler(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const result = await scanAllExceptions();
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
