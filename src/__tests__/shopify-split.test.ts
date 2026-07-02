import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  splitFulfillmentOrders,
  fetchFulfillmentGroupInfo,
} from "@/lib/shopify/split";
import { pushFulfillmentToShopify } from "@/lib/shopify/fulfillments";

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "test.myshopify.com";
  process.env.SHOPIFY_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2025-01";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const numId = (gid: string): string => gid.match(/\/(\d+)$/)?.[1] ?? gid;
const resp = (obj: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(obj),
  json: async () => obj,
});

interface FakeFo {
  id: number;
  status: string;
  lines: { foLiId: number; li: number }[];
}

/** Stateful fake of the Shopify GraphQL fulfillment-order split API. */
function fakeShopifyGraphql(initial: FakeFo[]) {
  const state: FakeFo[] = JSON.parse(JSON.stringify(initial));
  let nextId = 2000;
  let splitCalls = 0;

  const foQuery = () => ({
    data: {
      order: {
        fulfillmentOrders: {
          nodes: state.map((fo) => ({
            id: `gid://shopify/FulfillmentOrder/${fo.id}`,
            status: fo.status,
            lineItems: {
              nodes: fo.lines.map((l) => ({
                id: `gid://shopify/FulfillmentOrderLineItem/${l.foLiId}`,
                remainingQuantity: 1,
                lineItem: { id: `gid://shopify/LineItem/${l.li}` },
              })),
            },
          })),
        },
      },
    },
  });

  const fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (body.query.includes("fulfillmentOrderSplit")) {
      splitCalls++;
      const split = (body.variables.splits as Array<{
        fulfillmentOrderId: string;
        fulfillmentOrderLineItems: { id: string }[];
      }>)[0];
      const srcId = numId(split.fulfillmentOrderId);
      const move = new Set(split.fulfillmentOrderLineItems.map((x) => numId(x.id)));
      const src = state.find((fo) => String(fo.id) === srcId)!;
      const moved = src.lines.filter((l) => move.has(String(l.foLiId)));
      src.lines = src.lines.filter((l) => !move.has(String(l.foLiId)));
      state.push({ id: nextId++, status: "OPEN", lines: moved });
      return resp({ data: { fulfillmentOrderSplit: { userErrors: [] } } });
    }
    return resp(foQuery());
  });

  return { fetch, getSplitCalls: () => splitCalls };
}

describe("splitFulfillmentOrders", () => {
  it("splits a single fulfillment order into two groups", async () => {
    const fake = fakeShopifyGraphql([
      {
        id: 900,
        status: "OPEN",
        lines: [
          { foLiId: 10, li: 100 },
          { foLiId: 11, li: 101 },
          { foLiId: 12, li: 102 },
        ],
      },
    ]);
    vi.stubGlobal("fetch", fake.fetch);

    const mapping = await splitFulfillmentOrders("ORDER1", [
      { shopifyLineItemIds: ["100"] },
      { shopifyLineItemIds: ["101", "102"] },
    ]);

    expect(mapping).toEqual({ "100": "900", "101": "2000", "102": "2000" });
    expect(fake.getSplitCalls()).toBe(1);
  });

  it("performs one split per extra group (3 groups -> 2 splits)", async () => {
    const fake = fakeShopifyGraphql([
      {
        id: 900,
        status: "OPEN",
        lines: [
          { foLiId: 10, li: 100 },
          { foLiId: 11, li: 101 },
          { foLiId: 12, li: 102 },
        ],
      },
    ]);
    vi.stubGlobal("fetch", fake.fetch);

    const mapping = await splitFulfillmentOrders("ORDER1", [
      { shopifyLineItemIds: ["100"] },
      { shopifyLineItemIds: ["101"] },
      { shopifyLineItemIds: ["102"] },
    ]);

    // each line item ends up in a distinct fulfillment order
    const distinct = new Set(Object.values(mapping));
    expect(distinct.size).toBe(3);
    expect(mapping["100"]).toBe("900");
    expect(fake.getSplitCalls()).toBe(2);
  });

  it("does not split when each group is already its own fulfillment order", async () => {
    const fake = fakeShopifyGraphql([
      { id: 900, status: "OPEN", lines: [{ foLiId: 10, li: 100 }] },
      { id: 901, status: "OPEN", lines: [{ foLiId: 11, li: 101 }] },
    ]);
    vi.stubGlobal("fetch", fake.fetch);

    const mapping = await splitFulfillmentOrders("ORDER1", [
      { shopifyLineItemIds: ["100"] },
      { shopifyLineItemIds: ["101"] },
    ]);

    expect(mapping).toEqual({ "100": "900", "101": "901" });
    expect(fake.getSplitCalls()).toBe(0);
  });

  it("throws when the split mutation returns userErrors", async () => {
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { query: string };
      if (body.query.includes("fulfillmentOrderSplit")) {
        return resp({
          data: {
            fulfillmentOrderSplit: {
              userErrors: [{ field: ["x"], message: "cannot split" }],
            },
          },
        });
      }
      return resp({
        data: {
          order: {
            fulfillmentOrders: {
              nodes: [
                {
                  id: "gid://shopify/FulfillmentOrder/900",
                  status: "OPEN",
                  lineItems: {
                    nodes: [
                      {
                        id: "gid://shopify/FulfillmentOrderLineItem/10",
                        remainingQuantity: 1,
                        lineItem: { id: "gid://shopify/LineItem/100" },
                      },
                      {
                        id: "gid://shopify/FulfillmentOrderLineItem/11",
                        remainingQuantity: 1,
                        lineItem: { id: "gid://shopify/LineItem/101" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      splitFulfillmentOrders("ORDER1", [
        { shopifyLineItemIds: ["100"] },
        { shopifyLineItemIds: ["101"] },
      ])
    ).rejects.toThrow(/cannot split/);
  });
});

describe("fetchFulfillmentGroupInfo", () => {
  const foNode = (
    id: number,
    status: string,
    presentedName: string | null,
    lineItemIds: number[]
  ) => ({
    id: `gid://shopify/FulfillmentOrder/${id}`,
    status,
    deliveryMethod:
      presentedName === null
        ? null
        : { methodType: "SHIPPING", presentedName },
    lineItems: {
      nodes: lineItemIds.map((li) => ({
        lineItem: { id: `gid://shopify/LineItem/${li}` },
      })),
    },
  });

  it("maps fulfillment orders to numeric ids, delivery names, and line items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resp({
          data: {
            order: {
              fulfillmentOrders: {
                nodes: [
                  foNode(900, "OPEN", "Standard", [100, 101]),
                  foNode(901, "OPEN", "Express", [102]),
                ],
              },
            },
          },
        })
      )
    );

    const groups = await fetchFulfillmentGroupInfo("ORDER1");

    expect(groups).toEqual([
      {
        foId: "900",
        status: "OPEN",
        deliveryMethodName: "Standard",
        shopifyLineItemIds: ["100", "101"],
      },
      {
        foId: "901",
        status: "OPEN",
        deliveryMethodName: "Express",
        shopifyLineItemIds: ["102"],
      },
    ]);
  });

  it("returns null deliveryMethodName when the FO has no delivery method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resp({
          data: {
            order: {
              fulfillmentOrders: {
                nodes: [foNode(900, "CLOSED", null, [100])],
              },
            },
          },
        })
      )
    );

    const groups = await fetchFulfillmentGroupInfo("ORDER1");
    expect(groups).toEqual([
      {
        foId: "900",
        status: "CLOSED",
        deliveryMethodName: null,
        shopifyLineItemIds: ["100"],
      },
    ]);
  });

  it("throws when the order is not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resp({ data: { order: null } }))
    );

    await expect(fetchFulfillmentGroupInfo("MISSING")).rejects.toThrow(
      /not found/
    );
  });
});

describe("pushFulfillmentToShopify fulfillment order targeting", () => {
  function fakeRest(captured: { body?: unknown }) {
    return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes("/fulfillment_orders.json")) {
        return resp({
          fulfillment_orders: [
            { id: 111, status: "open", line_items: [{ id: 1, fulfillable_quantity: 1 }] },
            { id: 222, status: "open", line_items: [{ id: 2, fulfillable_quantity: 1 }] },
          ],
        });
      }
      if (url.includes("/fulfillments.json") && init?.method === "POST") {
        captured.body = JSON.parse(init.body!);
        return resp({ fulfillment: { id: 555, status: "success" } });
      }
      // GET order verification
      return resp({ order: { id: 1, name: "#1", line_items: [] } });
    });
  }

  it("only fulfills the targeted fulfillment order when fulfillmentOrderId is set", async () => {
    const captured: { body?: unknown } = {};
    vi.stubGlobal("fetch", fakeRest(captured));

    await pushFulfillmentToShopify({
      shopifyOrderId: "1",
      trackingNumber: "1Z999",
      carrier: "USPS",
      fulfillmentOrderId: "222",
    });

    const body = captured.body as {
      fulfillment: {
        line_items_by_fulfillment_order: { fulfillment_order_id: number }[];
      };
    };
    const fos = body.fulfillment.line_items_by_fulfillment_order;
    expect(fos).toHaveLength(1);
    expect(fos[0].fulfillment_order_id).toBe(222);
  });

  it("bundles all fulfillment orders when no fulfillmentOrderId is given", async () => {
    const captured: { body?: unknown } = {};
    vi.stubGlobal("fetch", fakeRest(captured));

    await pushFulfillmentToShopify({
      shopifyOrderId: "1",
      trackingNumber: "1Z999",
      carrier: "USPS",
    });

    const body = captured.body as {
      fulfillment: {
        line_items_by_fulfillment_order: { fulfillment_order_id: number }[];
      };
    };
    expect(body.fulfillment.line_items_by_fulfillment_order).toHaveLength(2);
  });
});
