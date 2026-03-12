import { shopifyApi, ApiVersion } from "@shopify/shopify-api";
import "@shopify/shopify-api/adapters/node";

let _shopify: ReturnType<typeof shopifyApi> | null = null;

function getShopify() {
  if (!_shopify) {
    const apiSecretKey = process.env.SHOPIFY_API_SECRET;
    if (!apiSecretKey) {
      throw new Error(
        "SHOPIFY_API_SECRET is not set. Configure Shopify env vars to use this feature."
      );
    }

    _shopify = shopifyApi({
      apiKey: process.env.SHOPIFY_API_KEY || "",
      apiSecretKey,
      scopes: ["read_orders", "write_orders", "read_fulfillments", "write_fulfillments"],
      hostName: process.env.SHOPIFY_STORE_DOMAIN || "",
      apiVersion: (process.env.SHOPIFY_API_VERSION as ApiVersion) || ApiVersion.January26,
      isEmbeddedApp: false,
      isCustomStoreApp: true,
      adminApiAccessToken: process.env.SHOPIFY_ACCESS_TOKEN || "",
    });
  }
  return _shopify;
}

/**
 * Create a REST client for the Shopify Admin API.
 * Uses the store domain and access token from environment variables.
 */
export function createShopifyRestClient() {
  const shopify = getShopify();
  const session = shopify.session.customAppSession(
    process.env.SHOPIFY_STORE_DOMAIN || ""
  );
  session.accessToken = process.env.SHOPIFY_ACCESS_TOKEN || "";

  return new shopify.clients.Rest({ session });
}

export { getShopify as shopify };
