import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scanAllExceptions } from "@/lib/exceptions/detector";

/**
 * POST /api/exceptions/scan
 *
 * Session-authenticated scan endpoint for dashboard users.
 * No CRON_SECRET needed — requires a valid logged-in session.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
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
