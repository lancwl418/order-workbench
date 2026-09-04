/**
 * Minimal Shopify Admin GraphQL client shared by the modules that need
 * GraphQL-only data (fulfillment-order split, product tags/metafields).
 */

function gqlEndpoint() {
  const store = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2025-01";
  return `https://${store}/admin/api/${version}/graphql.json`;
}

export async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = process.env.SHOPIFY_ACCESS_TOKEN!;
  const endpoint = gqlEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  const looksLikeJson = text.trimStart().startsWith("{") || text.trimStart().startsWith("[");

  // A non-JSON body (usually an HTML login/redirect page) means the request
  // never reached the GraphQL API as authenticated — almost always a bad or
  // stale SHOPIFY_ACCESS_TOKEN, or one missing a required access scope.
  if (!looksLikeJson) {
    console.error(
      `[Shopify GraphQL] non-JSON response from ${endpoint} (HTTP ${res.status}): ${text.substring(0, 300)}`
    );
    throw new Error(
      `Shopify GraphQL returned a non-JSON response (HTTP ${res.status}). ` +
        `Verify SHOPIFY_ACCESS_TOKEN is valid and has the required access scopes.`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Shopify GraphQL HTTP ${res.status}: ${text.substring(0, 500)}`
    );
  }
  const json = JSON.parse(text) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(
      `Shopify GraphQL errors: ${JSON.stringify(json.errors).substring(0, 500)}`
    );
  }
  return json.data as T;
}
