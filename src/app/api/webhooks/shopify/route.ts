import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook, processShopifyWebhook } from "@/lib/shopify/webhooks";

/**
 * POST /api/webhooks/shopify
 *
 * Receives and processes incoming Shopify webhooks.
 * Verifies HMAC signature before processing.
 * No auth check -- Shopify cannot authenticate with our session.
 */
export async function POST(req: NextRequest) {
  try {
    // Read the raw body for HMAC verification
    const rawBody = await req.text();
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const topic = req.headers.get("x-shopify-topic");

    if (!hmacHeader) {
      return NextResponse.json(
        { error: "Missing HMAC header" },
        { status: 401 }
      );
    }

    if (!topic) {
      return NextResponse.json(
        { error: "Missing topic header" },
        { status: 400 }
      );
    }

    // Verify the webhook signature
    const isValid = verifyWebhook(rawBody, hmacHeader);
    if (!isValid) {
      console.error("Shopify webhook HMAC verification failed");
      return NextResponse.json(
        { error: "Invalid HMAC signature" },
        { status: 401 }
      );
    }

    // Parse the payload
    const payload = JSON.parse(rawBody);

    // Process the webhook
    const result = await processShopifyWebhook(topic, payload);

    return NextResponse.json({
      success: true,
      topic,
      ...result,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error("Shopify webhook processing error:", errorMessage);
    return NextResponse.json(
      { error: "Webhook processing failed", details: errorMessage },
      { status: 500 }
    );
  }
}
