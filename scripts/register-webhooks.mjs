#!/usr/bin/env node
/**
 * Register Shopify webhooks for order and fulfillment sync.
 *
 * Usage: node scripts/register-webhooks.mjs
 *
 * Reads SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, and
 * NEXT_PUBLIC_APP_URL from .env file.
 */
import "dotenv/config";

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

if (!STORE || !TOKEN || !APP_URL) {
  console.error("Missing env: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, NEXT_PUBLIC_APP_URL");
  process.exit(1);
}

const WEBHOOK_URL = `${APP_URL}/api/webhooks/shopify`;
const BASE = `https://${STORE}/admin/api/${API_VERSION}`;

const TOPICS = [
  "orders/create",
  "orders/updated",
  "fulfillments/create",
  "fulfillments/update",
];

async function shopifyFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log(`Store: ${STORE}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}\n`);

  // List existing webhooks
  const { webhooks: existing } = await shopifyFetch("/webhooks.json");
  console.log(`Existing webhooks: ${existing.length}`);
  for (const w of existing) {
    console.log(`  - ${w.topic} → ${w.address} (id: ${w.id})`);
  }
  console.log();

  // Register each topic
  for (const topic of TOPICS) {
    const alreadyExists = existing.find(
      (w) => w.topic === topic && w.address === WEBHOOK_URL
    );

    if (alreadyExists) {
      console.log(`✓ ${topic} — already registered`);
      continue;
    }

    try {
      const { webhook } = await shopifyFetch("/webhooks.json", {
        method: "POST",
        body: JSON.stringify({
          webhook: {
            topic,
            address: WEBHOOK_URL,
            format: "json",
          },
        }),
      });
      console.log(`✓ ${topic} — registered (id: ${webhook.id})`);
    } catch (err) {
      console.error(`✗ ${topic} — failed: ${err.message}`);
    }
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
