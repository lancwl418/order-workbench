import { Prisma } from "@prisma/client";
import type { OrderItem, Supplier, SupplierPush } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getVariantImageUrl } from "@/lib/shopify/product-images";
import { pushFulfillmentToShopify } from "@/lib/shopify/fulfillments";
import { ensureBlanksSplit } from "@/lib/orders/blanks-split";
import { getAdapter } from "./registry";
import {
  deriveStyleCode,
  normalizeVendor,
  REJECTED_ORDER_STATUS,
  SHIPPED_ORDER_STATUS,
  TERMINAL_ORDER_STATUSES,
  trackingsMatch,
  type SupplierConsignee,
  type SupplierOrderInput,
  type SupplierOrderItemInput,
} from "./types";

// Single implementation of the blanks push flow, shared by every entry point
// (order list, order detail, blanks page, cron): place orders per supplier
// group, re-push placed-but-unpushed orders, and sync statuses.

// ─── Input shapes (validated by the routes' zod schemas) ────────

export interface BlanksItemInput {
  orderItemId: string;
  /** Send this item to a specific supplier instead of its vendor mapping. */
  supplierId?: string;
  factorySku: string;
  sizeCode?: string;
  sizeName?: string;
  colorCode?: string;
  colorName?: string;
  styleCode?: string;
  styleName?: string;
  craftType?: 1 | 2;
  shouldPrint?: boolean;
  printPosition?: "1" | "2" | "1,2";
  imageUrls?: string[];
  effectImageUrls?: string[];
}

export type BlanksPushMode = "place" | "place_and_push";

export interface BlanksGroupResult {
  supplierId: string;
  supplierKey: string;
  supplierName: string;
  platformOid: string | null;
  itemIds: string[];
  status: "pushed" | "placed" | "failed";
  error?: string;
  pushError?: string;
  traceId?: string;
}

// ─── Helpers ────────────────────────────────────────────────────

export function buildSupplierConsignee(
  shippingAddress: Record<string, unknown> | null | undefined,
  customerName: string | null
): SupplierConsignee | null {
  if (!shippingAddress) return null;
  const a = shippingAddress as Record<string, string | undefined>;
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || customerName || "";
  const phone = a.phone || "";
  const address = a.address1 || "";
  const province = a.province_code || a.province || "";
  const city = a.city || "";
  const country = a.country_code || a.country || "";
  if (!name || !phone || !address || !province || !city || !country) return null;
  return {
    name,
    phone,
    address,
    addressOptional: a.address2 || undefined,
    country,
    province,
    city,
    postCode: a.zip || a.postal_code || undefined,
  };
}

/**
 * Resolve which supplier each blank item routes to via its vendor. Returns
 * per-supplier groups plus the items that cannot be routed (no vendor, or
 * vendor not mapped) — callers surface those instead of pushing.
 *
 * `overrides` (itemId → supplierId) lets the operator send an item to an
 * alternate supplier (e.g. group a linmiao-vendor tee with the order's
 * jjspromo items); overridden items skip vendor routing entirely.
 */
export async function resolveSupplierGroups(
  items: OrderItem[],
  overrides?: Map<string, string>
): Promise<{
  groups: { supplier: Supplier; items: OrderItem[] }[];
  unroutable: { itemId: string; title: string; vendor: string | null; reason: "no_vendor" | "unmapped_vendor" | "bad_supplier" }[];
}> {
  const vendors = [...new Set(
    items.map((i) => (i.vendor ? normalizeVendor(i.vendor) : null)).filter((v): v is string => !!v)
  )];
  const mappings = vendors.length
    ? await prisma.vendorMapping.findMany({
        where: { vendor: { in: vendors } },
        include: { supplier: true },
      })
    : [];
  const supplierByVendor = new Map(mappings.map((m) => [m.vendor, m.supplier]));

  const overrideIds = [...new Set(overrides?.values() ?? [])];
  const overrideSuppliers = overrideIds.length
    ? await prisma.supplier.findMany({ where: { id: { in: overrideIds }, enabled: true } })
    : [];
  const supplierById = new Map(overrideSuppliers.map((s) => [s.id, s]));

  const bySupplier = new Map<string, { supplier: Supplier; items: OrderItem[] }>();
  const unroutable: { itemId: string; title: string; vendor: string | null; reason: "no_vendor" | "unmapped_vendor" | "bad_supplier" }[] = [];

  for (const item of items) {
    let supplier: Supplier | undefined;
    const overrideId = overrides?.get(item.id);
    if (overrideId) {
      supplier = supplierById.get(overrideId);
      if (!supplier) {
        unroutable.push({ itemId: item.id, title: item.title, vendor: item.vendor, reason: "bad_supplier" });
        continue;
      }
    } else {
      const vendor = item.vendor ? normalizeVendor(item.vendor) : null;
      if (!vendor) {
        unroutable.push({ itemId: item.id, title: item.title, vendor: item.vendor, reason: "no_vendor" });
        continue;
      }
      supplier = supplierByVendor.get(vendor);
      if (!supplier) {
        unroutable.push({ itemId: item.id, title: item.title, vendor: item.vendor, reason: "unmapped_vendor" });
        continue;
      }
    }
    const group = bySupplier.get(supplier.id) ?? { supplier, items: [] };
    group.items.push(item);
    bySupplier.set(supplier.id, group);
  }

  return { groups: [...bySupplier.values()], unroutable };
}

function toSupplierItemInput(item: OrderItem, m: BlanksItemInput): SupplierOrderItemInput {
  const sizeCode = m.sizeCode || "";
  const colorCode = m.colorCode || "";
  const styleCode = m.styleCode || deriveStyleCode(m.factorySku, colorCode, sizeCode);
  return {
    orderItemId: item.id,
    title: item.title,
    quantity: item.quantity,
    price: Number(item.price),
    ourSku: item.sku,
    factorySku: m.factorySku,
    sizeCode,
    sizeName: m.sizeName || sizeCode,
    colorCode,
    colorName: m.colorName || colorCode,
    styleCode,
    styleName: m.styleName || styleCode,
    craftType: m.craftType ?? 1,
    shouldPrint: m.shouldPrint ?? false,
    printPosition: m.printPosition,
    printImageUrls: m.imageUrls ?? [],
    effectImageUrls: m.effectImageUrls ?? (item.designFileUrl ? [item.designFileUrl] : []),
  };
}

/**
 * linmiao requires a non-empty effect image even for no-print blanks. When
 * the operator leaves it blank, borrow the Shopify variant/product image;
 * as a last resort use the configurable placeholder.
 */
async function resolveAutoEffectImage(
  shopifyRawJson: unknown,
  item: OrderItem
): Promise<string> {
  const lineItems = (
    shopifyRawJson as { line_items?: { id?: number | string; product_id?: number | string | null; variant_id?: number | string | null }[] } | null
  )?.line_items;
  const lineItem = Array.isArray(lineItems)
    ? lineItems.find((l) => l && String(l.id) === item.shopifyLineItemId)
    : undefined;
  if (lineItem?.product_id) {
    const url = await getVariantImageUrl(
      String(lineItem.product_id),
      lineItem.variant_id ? String(lineItem.variant_id) : null
    );
    if (url) return url;
  }
  return process.env.BLANKS_PLACEHOLDER_IMAGE_URL ?? "https://placehold.co/200x200.png";
}

async function upsertSkuMappings(
  tx: Prisma.TransactionClient,
  supplierId: string,
  items: { item: OrderItem; input: SupplierOrderItemInput }[]
) {
  for (const { item, input } of items) {
    if (!item.sku) continue;
    const values = {
      factorySku: input.factorySku,
      factorySize: input.sizeCode || null,
      factoryColor: input.colorCode || null,
      factoryStyle: input.styleCode || null,
      factoryCraftType: input.craftType,
    };
    const existing = await tx.skuMapping.findFirst({
      where: { ourSku: item.sku, variantTitle: item.variantTitle ?? "", supplierId },
    });
    if (existing) {
      await tx.skuMapping.update({
        where: { id: existing.id },
        data: { ...values, lastUsedAt: new Date() },
      });
    } else {
      await tx.skuMapping.create({
        data: { ourSku: item.sku, variantTitle: item.variantTitle ?? "", supplierId, ...values },
      });
    }
  }
}

// ─── Place (and optionally push) blanks per supplier group ──────

export async function pushBlanksForOrder(opts: {
  orderId: string;
  mode: BlanksPushMode;
  items: BlanksItemInput[];
  sellerRemark?: string;
  userId?: string;
  /** Allow placing again for a supplier that already has a push — the new
   * order gets a sequential suffix (#3940-linmiao-1, -2, …). */
  replace?: boolean;
  /** Edited consignee from the dialog — used for this push and persisted
   * back onto the order's shipping address. */
  consignee?: SupplierConsignee;
}): Promise<{ results: BlanksGroupResult[]; error?: string; status?: number }> {
  const { orderId, mode, items, sellerRemark, userId, replace } = opts;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });
  if (!order) return { results: [], error: "Order not found", status: 404 };
  if (!order.shopifyOrderNumber) {
    return { results: [], error: "Order is missing Shopify order number", status: 400 };
  }

  const consignee =
    opts.consignee ??
    buildSupplierConsignee(
      order.shippingAddress as Record<string, unknown> | null,
      order.customerName
    );
  const missing = consignee
    ? (["name", "phone", "address", "city", "province", "country"] as const).filter(
        (k) => !consignee[k]?.trim()
      )
    : ["name", "phone", "address", "city", "province", "country"];
  if (!consignee || missing.length > 0) {
    return {
      results: [],
      error: `Order shipping address is incomplete — missing: ${missing.join(", ")}. Edit the address in the dialog.`,
      status: 400,
    };
  }

  // Persist dialog edits so the fix sticks for later pushes/re-pushes.
  if (opts.consignee) {
    const existing = (order.shippingAddress as Record<string, unknown> | null) ?? {};
    await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingAddress: {
          ...existing,
          first_name: consignee.name,
          last_name: "",
          phone: consignee.phone,
          address1: consignee.address,
          address2: consignee.addressOptional ?? null,
          city: consignee.city,
          province: consignee.province,
          province_code: consignee.province,
          country: consignee.country,
          country_code: consignee.country,
          zip: consignee.postCode ?? null,
        } as Prisma.InputJsonValue,
      },
    });
  }

  const itemById = new Map(order.orderItems.map((i) => [i.id, i]));
  const inputByItemId = new Map<string, BlanksItemInput>();
  for (const m of items) {
    const item = itemById.get(m.orderItemId);
    if (!item) {
      return { results: [], error: `Item ${m.orderItemId} does not belong to this order`, status: 400 };
    }
    if (item.itemType !== "other") {
      return { results: [], error: `Item "${item.title}" is not a blank (itemType=${item.itemType})`, status: 400 };
    }
    inputByItemId.set(m.orderItemId, m);
  }

  const selectedItems = [...inputByItemId.keys()].map((id) => itemById.get(id)!);
  // Server-side routing — the supplier is re-resolved here; explicit per-item
  // overrides are honored only for enabled suppliers.
  const overrides = new Map<string, string>();
  for (const [itemId, m] of inputByItemId) {
    if (m.supplierId) overrides.set(itemId, m.supplierId);
  }
  const { groups, unroutable } = await resolveSupplierGroups(selectedItems, overrides);
  if (unroutable.length > 0) {
    const detail = unroutable
      .map((u) => {
        const reason =
          u.reason === "no_vendor"
            ? "no vendor"
            : u.reason === "bad_supplier"
              ? "selected supplier unavailable"
              : `vendor "${u.vendor}" not mapped`;
        return `"${u.title}" (${reason})`;
      })
      .join(", ");
    return { results: [], error: `Cannot route items to a supplier: ${detail}`, status: 400 };
  }

  // Validate images up front so one group doesn't fail after another placed.
  // Effect images are optional for no-print blanks — the "[不打印]" marker is
  // always sent; if a factory insists on an effect image the per-group error
  // surfaces in the dialog and the group can be retried with one.
  for (const group of groups) {
    for (const item of group.items) {
      const m = inputByItemId.get(item.id)!;
      const input = toSupplierItemInput(item, m);
      if (input.shouldPrint && input.printImageUrls.length === 0) {
        return { results: [], error: `Item "${item.title}" is set to print but has no print image`, status: 400 };
      }
      if (!input.sizeCode.trim() || !input.colorCode.trim()) {
        return { results: [], error: `Item "${item.title}" needs both size and color (factory-required fields)`, status: 400 };
      }
    }
  }

  const results: BlanksGroupResult[] = [];

  for (const group of groups) {
    const { supplier } = group;
    const baseOid = `${order.shopifyOrderNumber}-${supplier.key}`;

    // Sequential platformOid: first place uses the base, re-places append
    // -1, -2, … (only when the caller explicitly asked to replace).
    const priorCount = await prisma.supplierPush.count({
      where: { orderId: order.id, supplierId: supplier.id },
    });
    if (priorCount > 0 && !replace) {
      const prior = await prisma.supplierPush.findFirst({
        where: { orderId: order.id, supplierId: supplier.id },
        orderBy: { createdAt: "desc" },
      });
      results.push({
        supplierId: supplier.id,
        supplierKey: supplier.key,
        supplierName: supplier.name,
        itemIds: group.items.map((i) => i.id),
        platformOid: prior?.platformOid ?? baseOid,
        status: "failed",
        error: prior?.pushedAt
          ? "Already placed and pushed to this supplier"
          : "Already placed at this supplier — use re-push, or re-place with a new sequential order number",
      });
      continue;
    }
    let suffix = priorCount;
    let platformOid = suffix === 0 ? baseOid : `${baseOid}-${suffix}`;
    while (await prisma.supplierPush.findUnique({ where: { platformOid } })) {
      suffix += 1;
      platformOid = `${baseOid}-${suffix}`;
    }

    const itemInputs = await Promise.all(
      group.items.map(async (item) => {
        const input = toSupplierItemInput(item, inputByItemId.get(item.id)!);
        if (!input.shouldPrint && input.effectImageUrls.length === 0) {
          input.effectImageUrls = [await resolveAutoEffectImage(order.shopifyRawJson, item)];
        }
        return { item, input };
      })
    );
    const base = {
      supplierId: supplier.id,
      supplierKey: supplier.key,
      supplierName: supplier.name,
      itemIds: group.items.map((i) => i.id),
    };

    const orderInput: SupplierOrderInput = {
      platformOid,
      sourceOrderId: order.id,
      consignee,
      orderTime: order.shopifyCreatedAt ?? order.createdAt,
      sellerRemark,
      items: itemInputs.map((x) => x.input),
    };

    try {
      const adapter = getAdapter(supplier);
      const result = await adapter.placeOrder(orderInput, { push: mode === "place_and_push" });

      // Remote DB + several sequential writes — the default 5s interactive
      // transaction timeout is too tight.
      await prisma.$transaction(async (tx) => {
        await tx.supplierPush.create({
          data: {
            orderId: order.id,
            supplierId: supplier.id,
            platformOid,
            itemIds: base.itemIds,
            pushedAt: result.pushed ? new Date() : null,
            lastError: result.pushError ?? null,
            traceId: result.traceId ?? null,
            requestPayload: JSON.parse(JSON.stringify(orderInput)) as Prisma.InputJsonValue,
          },
        });
        for (const { item, input } of itemInputs) {
          await tx.orderItem.update({
            where: { id: item.id },
            data: {
              supplierId: supplier.id,
              supplierOrderNo: platformOid,
              supplierTraceId: result.traceId ?? null,
              supplierPushedAt: result.pushed ? new Date() : null,
              printEnabled: input.shouldPrint,
              factorySku: input.factorySku,
              factorySize: input.sizeCode || null,
              factoryColor: input.colorCode || null,
              factoryStyle: input.styleCode || null,
              factoryCraftType: input.craftType,
            },
          });
        }
        await upsertSkuMappings(tx, supplier.id, itemInputs);
        await tx.orderLog.create({
          data: {
            orderId: order.id,
            userId,
            action: "blanks_push",
            toValue: result.pushed ? "pushed" : "placed",
            message: `${supplier.name}: ${result.pushed ? "placed and pushed to factory" : "order placed (not pushed yet)"}${result.pushError ? ` — push failed: ${result.pushError}` : ""}`,
            metadata: { platformOid, supplierKey: supplier.key, traceId: result.traceId, itemIds: base.itemIds },
          },
        });
      }, { maxWait: 10_000, timeout: 30_000 });

      results.push({
        ...base,
        platformOid,
        status: result.pushed ? "pushed" : "placed",
        pushError: result.pushError,
        traceId: result.traceId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Supplier push failed";
      const traceId = (e as Error & { traceId?: string }).traceId;
      await prisma.orderLog.create({
        data: {
          orderId: order.id,
          userId,
          action: "blanks_push_failed",
          message: `${supplier.name}: ${message}`.slice(0, 500),
          metadata: { platformOid, supplierKey: supplier.key, traceId, itemIds: base.itemIds },
        },
      });
      results.push({ ...base, platformOid, status: "failed", error: message, traceId });
    }
  }

  return { results };
}

// ─── Re-push a placed-but-unpushed order to the factory ─────────

export async function pushPlacedSupplierPush(
  pushId: string,
  userId?: string
): Promise<{ push?: SupplierPush; error?: string; status?: number }> {
  const push = await prisma.supplierPush.findUnique({
    where: { id: pushId },
    include: { supplier: true },
  });
  if (!push) return { error: "Supplier push not found", status: 404 };
  if (push.pushedAt) return { error: "Already pushed to the factory", status: 400 };

  const adapter = getAdapter(push.supplier);
  const result = await adapter.pushToFactory([push.platformOid]);
  const failure = result.failed.find((f) => f.platformOid === push.platformOid);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.supplierPush.update({
      where: { id: push.id },
      data: failure
        ? { lastError: failure.reason }
        : { pushedAt: new Date(), lastError: null },
    });
    if (!failure) {
      await tx.orderItem.updateMany({
        where: { id: { in: push.itemIds } },
        data: { supplierPushedAt: new Date() },
      });
    }
    await tx.orderLog.create({
      data: {
        orderId: push.orderId,
        userId,
        action: failure ? "blanks_push_failed" : "blanks_push",
        toValue: failure ? undefined : "pushed",
        message: failure
          ? `${push.supplier.name}: push to factory failed — ${failure.reason}`.slice(0, 500)
          : `${push.supplier.name}: pushed to factory`,
        metadata: { platformOid: push.platformOid, supplierKey: push.supplier.key, traceId: result.traceId },
      },
    });
    return row;
  }, { maxWait: 10_000, timeout: 30_000 });

  if (failure) return { push: updated, error: failure.reason, status: 502 };
  return { push: updated };
}

// ─── Factory tracking → Shopify fulfillment ─────────────────────

/**
 * Sync a push's factory tracking back to Shopify. Reuses an existing
 * shipment with the same tracking (the linmiao flow: our OMS label's number
 * comes back as the factory courierNumber) or creates one scoped to the
 * blanks fulfillment group. Shared by the auto sync and the manual button.
 */
export async function syncPushTrackingToShopify(
  pushId: string,
  userId?: string
): Promise<{ synced: boolean; error?: string }> {
  const push = await prisma.supplierPush.findUnique({
    where: { id: pushId },
    include: {
      supplier: true,
      order: {
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyOrderNumber: true,
          orderItems: { select: { id: true, itemType: true, shopifyFulfillmentOrderId: true } },
        },
      },
    },
  });
  if (!push) return { synced: false, error: "Push not found" };
  if (!push.trackingNumber) return { synced: false, error: "No factory tracking yet" };
  if (!push.order.shopifyOrderId) return { synced: false, error: "Order is not linked to Shopify" };

  // Containment match, not equality — linmiao returns our label number with
  // the order number appended, and that must reuse the OMS shipment.
  const orderShipments = await prisma.shipment.findMany({
    where: { orderId: push.orderId, trackingNumber: { not: null } },
  });
  let shipment =
    orderShipments.find((sh) => trackingsMatch(sh.trackingNumber, push.trackingNumber)) ?? null;
  if (shipment?.syncStatus === "SYNCED") return { synced: true };

  const pushItems = push.order.orderItems.filter((i) => push.itemIds.includes(i.id));
  let groupFoId =
    pushItems.find((i) => i.shopifyFulfillmentOrderId)?.shopifyFulfillmentOrderId ?? null;

  // Mixed order without a fulfillment group: the Shopify call would fulfill
  // EVERYTHING (transfer included) under the blanks tracking. Auto-split
  // first (blanks per supplier) so the tracking lands on its own group.
  const hasNonBlanks = push.order.orderItems.some((i) => i.itemType !== "other");
  let foId = shipment?.shopifyFulfillmentOrderId ?? groupFoId;
  if (hasNonBlanks && !foId) {
    const splitResult = await ensureBlanksSplit(push.orderId, userId);
    if (splitResult.error) {
      return { synced: false, error: `Auto-split failed: ${splitResult.error}` };
    }
    groupFoId =
      (splitResult.foIdByItemId &&
        pushItems.map((i) => splitResult.foIdByItemId![i.id]).find(Boolean)) ?? null;
    foId = shipment?.shopifyFulfillmentOrderId ?? groupFoId;
    if (!foId) {
      return {
        synced: false,
        error: "Mixed order without a blanks fulfillment group — split the order first",
      };
    }
  }

  if (!shipment) {
    shipment = await prisma.shipment.create({
      data: {
        orderId: push.orderId,
        sourceType: "THIRD_PARTY",
        providerName: push.supplier.key,
        trackingNumber: push.trackingNumber,
        carrier: push.carrier,
        status: "shipped",
        shippedAt: push.shippedAt ?? new Date(),
        labelStatus: "CREATED",
        shopifyFulfillmentOrderId: groupFoId,
      },
    });
  }

  try {
    const result = await pushFulfillmentToShopify({
      shopifyOrderId: push.order.shopifyOrderId,
      trackingNumber: push.trackingNumber,
      carrier: push.carrier ?? shipment.carrier ?? "USPS",
      fulfillmentOrderId: foId ?? undefined,
    });
    try {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          shopifyFulfillmentId: result.fulfillmentId,
          syncStatus: "SYNCED",
          labelStatus: "SYNCED_TO_SHOPIFY",
          status: "shipped",
          shippedAt: shipment.shippedAt ?? push.shippedAt ?? new Date(),
        },
      });
    } catch (err) {
      // Another shipment already owns this Shopify fulfillment id (e.g. the
      // OMS label was synced under a slightly different tracking string) —
      // keep the sync marked without duplicating the fulfillment link.
      if ((err as { code?: string }).code === "P2002") {
        await prisma.shipment.update({
          where: { id: shipment.id },
          data: {
            syncStatus: "SYNCED",
            labelStatus: "SYNCED_TO_SHOPIFY",
            status: "shipped",
            shippedAt: shipment.shippedAt ?? push.shippedAt ?? new Date(),
          },
        });
      } else {
        throw err;
      }
    }
    await prisma.orderLog.create({
      data: {
        orderId: push.orderId,
        userId,
        action: "fulfillment_pushed",
        toValue: result.fulfillmentId,
        message: `${push.supplier.name}: factory tracking ${push.trackingNumber} synced to Shopify`,
        metadata: { pushId: push.id, platformOid: push.platformOid, shipmentId: shipment.id },
      },
    });
    return { synced: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Shopify sync failed";
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { syncStatus: "FAILED", syncError: message.slice(0, 500) },
    });
    return { synced: false, error: message };
  }
}

/**
 * Re-attempt the tracking→Shopify sync for an order's pushes that already
 * have a factory tracking but no synced fulfillment yet (e.g. tracking
 * arrived before the order was split). Early-returns per push when synced.
 */
export async function resyncPendingTrackings(orderId: string, userId?: string): Promise<void> {
  const pushes = await prisma.supplierPush.findMany({
    where: { orderId, trackingNumber: { not: null } },
    select: { id: true },
  });
  for (const p of pushes) {
    await syncPushTrackingToShopify(p.id, userId).catch(() => {});
  }
}

// ─── Status sync (cron + manual refresh share this) ─────────────

const STATUS_BATCH = 100;

export async function syncSupplierStatuses(opts: { orderId?: string } = {}): Promise<{
  checked: number;
  updated: number;
  rejected: number;
  tracked: number;
  errors: string[];
}> {
  const pushes = await prisma.supplierPush.findMany({
    where: {
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
      OR: [
        { orderStatus: null },
        { orderStatus: { notIn: TERMINAL_ORDER_STATUSES } },
        // shipped but tracking not captured yet — keep polling for delivery
        { orderStatus: SHIPPED_ORDER_STATUS, trackingNumber: null },
      ],
    },
    include: { supplier: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let rejected = 0;
  let tracked = 0;
  const errors: string[] = [];

  const bySupplier = new Map<string, { supplier: Supplier; pushes: (SupplierPush & { supplier: Supplier })[] }>();
  for (const p of pushes) {
    const g = bySupplier.get(p.supplierId) ?? { supplier: p.supplier, pushes: [] };
    g.pushes.push(p);
    bySupplier.set(p.supplierId, g);
  }

  for (const { supplier, pushes: group } of bySupplier.values()) {
    let adapter;
    try {
      adapter = getAdapter(supplier);
    } catch (e) {
      errors.push(`${supplier.key}: ${e instanceof Error ? e.message : "adapter unavailable"}`);
      continue;
    }

    for (let i = 0; i < group.length; i += STATUS_BATCH) {
      const batch = group.slice(i, i + STATUS_BATCH);
      try {
        const statuses = await adapter.queryStatus(batch.map((p) => p.platformOid));
        const byOid = new Map(statuses.map((s) => [s.platformOid, s]));
        const newStatusById = new Map<string, number>();
        for (const push of batch) {
          const status = byOid.get(push.platformOid);
          if (!status || status.orderStatus === null) continue;
          const changed = status.orderStatus !== push.orderStatus;
          newStatusById.set(push.id, status.orderStatus);
          await prisma.supplierPush.update({
            where: { id: push.id },
            data: {
              orderStatus: status.orderStatus,
              orderStatusStr: status.orderStatusStr,
              statusSyncedAt: new Date(),
              // A (re-)rejection activates the handling workflow
              ...(changed && status.orderStatus === REJECTED_ORDER_STATUS
                ? { rejectionStatus: "pending", rejectionHandledBy: null, rejectionHandledAt: null }
                : {}),
            },
          });
          if (changed) {
            updated++;
            if (status.orderStatus === REJECTED_ORDER_STATUS) {
              rejected++;
              await prisma.orderLog.create({
                data: {
                  orderId: push.orderId,
                  action: "blanks_rejected",
                  toValue: String(status.orderStatus),
                  message: `${supplier.name}: order ${push.platformOid} sent back by the factory (反审回电商)`,
                  metadata: { platformOid: push.platformOid, supplierKey: supplier.key },
                },
              });
            }
          }
        }

        // Fetch factory tracking for pushes that don't have it yet. Not
        // gated on "shipped": linmiao records the uploaded label's courier
        // number while still in production (status 4+), and riin simply
        // returns nothing until it ships — harmless to ask early.
        const needDelivery = batch.filter((push) => {
          const s = newStatusById.get(push.id) ?? push.orderStatus;
          return s !== null && s >= 4 && s <= SHIPPED_ORDER_STATUS && !push.trackingNumber;
        });
        if (needDelivery.length > 0) {
          const deliveries = await adapter.queryDelivery(needDelivery.map((p) => p.platformOid));
          const deliveryByOid = new Map(deliveries.map((d) => [d.platformOid, d]));
          for (const push of needDelivery) {
            const d = deliveryByOid.get(push.platformOid);
            if (!d?.trackingNumber) continue;
            await prisma.supplierPush.update({
              where: { id: push.id },
              data: {
                trackingNumber: d.trackingNumber,
                carrier: d.carrier,
                waybillUrl: d.waybillUrl,
                shippedAt: d.shippedAt,
              },
            });
            tracked++;
            // Auto-sync the factory tracking to Shopify; failures are
            // reported and retried by the next sweep or the manual button.
            const sync = await syncPushTrackingToShopify(push.id);
            if (!sync.synced && sync.error) {
              errors.push(`${supplier.key} ${push.platformOid}: shopify sync — ${sync.error}`);
            }
          }
        }
      } catch (e) {
        errors.push(`${supplier.key}: ${e instanceof Error ? e.message : "status query failed"}`);
      }
    }
  }

  // Retry sweep: recent shipped pushes whose tracking never made it to a
  // synced Shopify fulfillment (earlier failure or pre-feature data).
  const retryCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const candidates = await prisma.supplierPush.findMany({
    where: {
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
      trackingNumber: { not: null },
      updatedAt: { gte: retryCutoff },
      order: { shopifyOrderId: { not: null } },
    },
    select: {
      id: true,
      trackingNumber: true,
      order: { select: { shipments: { select: { trackingNumber: true, syncStatus: true } } } },
    },
    take: 100,
  });
  // A push is pending only when ITS tracking lacks a synced fulfillment —
  // a synced transfer shipment on the same order must not mask it.
  const unsynced = candidates
    .filter(
      (p) =>
        !p.order.shipments.some(
          (sh) => sh.trackingNumber === p.trackingNumber && sh.syncStatus === "SYNCED"
        )
    )
    .slice(0, 20);
  for (const p of unsynced) {
    const sync = await syncPushTrackingToShopify(p.id);
    if (!sync.synced && sync.error) errors.push(`shopify sync ${p.id}: ${sync.error}`);
  }

  return { checked: pushes.length, updated, rejected, tracked, errors };
}
