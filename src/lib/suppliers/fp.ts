import type { Supplier } from "@prisma/client";
import { FpApiError, FpClient } from "./fp-client";
import type { FpOrderGoodsItem, FpOrderInfo, FpPlaceOrderLog, FpPlaceOrderParams } from "./fp-client";
import {
  formatOrderTime,
  type SupplierAdapter,
  type SupplierDelivery,
  type SupplierOrderInput,
  type SupplierOrderResult,
  type SupplierOrderStatus,
  type SupplierPushToFactoryResult,
} from "./types";

// FP ERP adapter (Xinfeiyang since 2026-11). Three protocol quirks the rest
// of the system must not need to know about:
//   1. placeOrder is asynchronous — we poll listPlaceOrderLog briefly to
//      surface immediate failures; truly pending orders resolve via the
//      status sync / webhook.
//   2. Orders can only be pushed at orderStatus=150 (ready to push), so
//      pushToFactory checks status first and reports not-ready as a failure
//      reason the operator can retry.
//   3. FP status codes (100..800) are normalized to the shared riin-style
//      enum so SupplierPush.orderStatus keeps one domain for sync + badges;
//      the original FP status is preserved in orderStatusStr.

// ─── Status normalization ────────────────────────────────────────

export const FP_ORDER_STATUS: Record<number, string> = {
  100: "待处理",
  130: "物流匹配中",
  150: "待推送",
  250: "待确认",
  300: "生产中",
  350: "已发货",
  400: "反审中",
  800: "已关闭",
};

/** FP status → shared (riin-style) enum used across sync + UI. */
export const FP_TO_SHARED_STATUS: Record<number, number> = {
  100: 1, // pending → 店铺审核中
  130: 1, // logistics matching → still pre-push
  150: 2, // ready to push → 店铺推送中(待推送)
  250: 4, // waiting for confirmation → 工厂审核
  300: 5, // in production → 生产中
  350: 12, // shipped → 已发货
  400: 3, // under reverse review → 反审回电商
  800: 13, // closed → 已关闭
};

export const FP_READY_TO_PUSH = 150;

export function normalizeFpStatus(fpStatus: number): { orderStatus: number; orderStatusStr: string } {
  const shared = FP_TO_SHARED_STATUS[fpStatus];
  const label = FP_ORDER_STATUS[fpStatus] ?? `未知状态`;
  return {
    // Unknown FP codes stay pre-push (1) so the sync keeps polling them.
    orderStatus: shared ?? 1,
    orderStatusStr: `${label}(FP:${fpStatus})`,
  };
}

// ─── Payload building (pure, exported for tests) ─────────────────

/**
 * FP wants the recipient name split. Shopify gives us one string — treat the
 * last word as the family name; single-word names get "-" as last name (the
 * field is required).
 */
export function splitRecipientName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: name.trim() || "-", lastName: "-" };
  const lastName = parts.pop()!;
  return { firstName: parts.join(" "), lastName };
}

/** Asset-center image name for a print file (letters/digits/_ only). */
export function fpImageName(orderItemId: string, index: number): string {
  return `${orderItemId.replace(/[^a-zA-Z0-9_]/g, "_")}_print_${index}`;
}

/**
 * Build the placeOrder payload. Printed items (goodsMode=1) reference
 * asset-center image NAMES — the adapter uploads them first and passes the
 * same names here via fpImageName().
 */
export function buildFpPlaceOrderParams(input: SupplierOrderInput): FpPlaceOrderParams {
  const { consignee } = input;
  const { firstName, lastName } = splitRecipientName(consignee.name);

  const orderGoodsList: FpOrderGoodsItem[] = input.items.map((item) => {
    if (!item.shouldPrint) {
      return {
        goodsMode: 2 as const,
        quantity: item.quantity,
        systemSku: item.factorySku,
        goodsName: item.title,
        thumbUrl: item.effectImageUrls[0],
      };
    }
    return {
      goodsMode: 1 as const,
      quantity: item.quantity,
      systemSku: item.factorySku,
      productProcessId: item.craftType,
      goodsName: item.title,
      thumbUrl: item.effectImageUrls[0],
      productionImages: item.printImageUrls.map((_, i) => ({
        printCode: item.fpPrintCode!,
        productionImageName: fpImageName(item.orderItemId, i),
        widthInBlueMask: item.fpPrintWidth,
        heightInBlueMask: item.fpPrintHeight,
      })),
    };
  });

  return {
    platformOid: input.platformOid,
    orderCreateTime: formatOrderTime(input.orderTime),
    recipientFirstName: firstName,
    recipientLastName: lastName,
    recipientPhone: consignee.phone,
    recipientPostCode: consignee.postCode ?? "",
    recipientCity: consignee.city,
    recipientState: consignee.province,
    recipientCountry: consignee.country,
    addressLine1: consignee.address,
    addressLine2: consignee.addressOptional,
    logisticsType: input.fpLogisticsType ?? 0,
    saleCountry: consignee.country,
    currencyType: "USD",
    orderGoodsList,
  };
}

/** Validate FP-specific requirements; returns a user-facing problem or null. */
export function validateFpOrderInput(input: SupplierOrderInput): string | null {
  if (!input.consignee.postCode?.trim()) {
    return "FP ERP requires a recipient post code — edit the address in the dialog";
  }
  for (const item of input.items) {
    if (!item.factorySku.trim()) {
      return `Item "${item.title}" needs a systemSku (FP product-detail SKU) in the factory SKU field`;
    }
    if (item.shouldPrint) {
      if (!item.fpPrintCode?.trim()) {
        return `Item "${item.title}" is set to print but has no FP print position code`;
      }
      if (!item.fpPrintWidth || item.fpPrintWidth <= 0) {
        return `Item "${item.title}" is set to print but has no print width`;
      }
      if (item.printImageUrls.length === 0) {
        return `Item "${item.title}" is set to print but has no print image`;
      }
    }
  }
  return null;
}

// ─── List unwrapping (FP paginated payloads vary) ────────────────

function unwrapList<T>(data: T[] | { list?: T[]; records?: T[] } | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.list ?? data.records ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Adapter ─────────────────────────────────────────────────────

const PLACE_POLL_TRIES = 5;
const PLACE_POLL_INTERVAL_MS = 2_500;
const PUSH_READY_TRIES = 6;
const PUSH_READY_INTERVAL_MS = 3_000;

export class FpAdapter implements SupplierAdapter {
  readonly supplier: Supplier;
  private readonly client: FpClient;

  constructor(supplier: Supplier, client: FpClient) {
    this.supplier = supplier;
    this.client = client;
  }

  async placeOrder(
    input: SupplierOrderInput,
    opts: { push: boolean }
  ): Promise<SupplierOrderResult> {
    const problem = validateFpOrderInput(input);
    if (problem) throw new FpApiError(problem);

    // Printed items reference asset-center names — upload the print files
    // first so placeOrder can resolve them.
    for (const item of input.items) {
      if (!item.shouldPrint) continue;
      for (const [i, url] of item.printImageUrls.entries()) {
        await this.client.uploadMaterialImage({
          imageName: fpImageName(item.orderItemId, i),
          imageUrl: url,
        });
      }
    }

    const params = buildFpPlaceOrderParams(input);
    const placed = await this.client.placeOrder(params);

    // placeOrder is async: poll the creation log briefly so hard failures
    // (bad SKU, bad address) surface in the dialog instead of a silent limbo.
    const creation = await this.pollCreationResult(input.platformOid);
    if (creation?.failed) {
      throw new FpApiError(
        `FP order creation failed: ${creation.reason ?? "see listPlaceOrderLog"}`,
        placed.traceId
      );
    }

    if (!opts.push) {
      return { platformOid: input.platformOid, traceId: placed.traceId, pushed: false, raw: placed.data };
    }

    // Push gate: FP only accepts batchPushOrder at status 150. Wait briefly
    // for logistics matching to finish; if it doesn't, placement still
    // succeeded — report via pushError so the operator re-pushes later.
    const pushResult = await this.pushWhenReady(input.platformOid);
    return {
      platformOid: input.platformOid,
      traceId: placed.traceId,
      pushed: pushResult.pushed,
      pushError: pushResult.error,
      raw: placed.data,
    };
  }

  private async pollCreationResult(
    platformOid: string
  ): Promise<{ failed: boolean; reason?: string } | null> {
    for (let i = 0; i < PLACE_POLL_TRIES; i++) {
      await sleep(PLACE_POLL_INTERVAL_MS);
      try {
        const res = await this.client.listPlaceOrderLog([platformOid]);
        const log = unwrapList<FpPlaceOrderLog>(res.data).find((l) => l.platformOid === platformOid);
        if (!log) continue;
        const outcome = creationOutcome(log);
        if (outcome !== null) return outcome;
      } catch {
        // Log polling must not fail a placement that was already accepted.
      }
    }
    return null; // still pending — the status sync/webhook picks it up later
  }

  private async pushWhenReady(platformOid: string): Promise<{ pushed: boolean; error?: string }> {
    let lastStatus: number | null = null;
    for (let i = 0; i < PUSH_READY_TRIES; i++) {
      const info = await this.queryRawInfo([platformOid]);
      lastStatus = info.get(platformOid)?.orderStatus ?? null;
      if (lastStatus === FP_READY_TO_PUSH) {
        const result = await this.pushToFactory([platformOid]);
        const failure = result.failed.find((f) => f.platformOid === platformOid);
        return failure ? { pushed: false, error: failure.reason } : { pushed: true };
      }
      await sleep(PUSH_READY_INTERVAL_MS);
    }
    const label = lastStatus !== null ? FP_ORDER_STATUS[lastStatus] ?? String(lastStatus) : "未返回";
    return {
      pushed: false,
      error: `FP 订单还未到可推送状态(当前:${label})——物流匹配完成后用"重新推送"`,
    };
  }

  private async queryRawInfo(platformOids: string[]): Promise<Map<string, FpOrderInfo>> {
    const res = await this.client.listOrderInfo(platformOids, {
      pageIndex: 1,
      pageSize: Math.max(platformOids.length, 20),
    });
    const rows = unwrapList<FpOrderInfo>(res.data);
    return new Map(rows.filter((r) => r.platformOid).map((r) => [r.platformOid, r]));
  }

  async pushToFactory(platformOids: string[]): Promise<SupplierPushToFactoryResult> {
    // FP rejects pushes for orders not at 150 — pre-check so each order gets
    // an actionable per-order reason instead of a batch-wide error.
    let info: Map<string, FpOrderInfo>;
    try {
      info = await this.queryRawInfo(platformOids);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "listOrderInfo failed";
      return {
        succeeded: [],
        failed: platformOids.map((platformOid) => ({ platformOid, reason })),
        traceId: e instanceof FpApiError ? e.traceId : undefined,
      };
    }

    const ready: string[] = [];
    const failed: { platformOid: string; reason: string }[] = [];
    for (const oid of platformOids) {
      const status = info.get(oid)?.orderStatus;
      if (status === FP_READY_TO_PUSH) {
        ready.push(oid);
      } else {
        const label = status !== undefined ? FP_ORDER_STATUS[status] ?? String(status) : "订单未找到";
        failed.push({ platformOid: oid, reason: `FP 状态不可推送(${label})——需要"待推送(150)"` });
      }
    }
    if (ready.length === 0) return { succeeded: [], failed };

    try {
      const res = await this.client.batchPushOrder(ready);
      return { succeeded: ready, failed, traceId: res.traceId };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "batchPushOrder failed";
      const traceId = e instanceof FpApiError ? e.traceId : undefined;
      return {
        succeeded: [],
        failed: [...failed, ...ready.map((platformOid) => ({ platformOid, reason }))],
        traceId,
      };
    }
  }

  async queryStatus(platformOids: string[]): Promise<SupplierOrderStatus[]> {
    const info = await this.queryRawInfo(platformOids);
    return platformOids.flatMap((oid) => {
      const row = info.get(oid);
      if (!row || typeof row.orderStatus !== "number") return [];
      const normalized = normalizeFpStatus(row.orderStatus);
      return [{ platformOid: oid, ...normalized }];
    });
  }

  /** Own-label (logisticsType=1) orders: upload the label when FP asks. */
  uploadShippingLabel(params: {
    platformOid: string;
    labelUrl: string;
    trackingNumber?: string;
    carrier?: string;
  }): Promise<unknown> {
    return this.client.uploadDelayShippingLabel(params);
  }

  async queryDelivery(platformOids: string[]): Promise<SupplierDelivery[]> {
    const info = await this.queryRawInfo(platformOids);
    return platformOids.flatMap((oid) => {
      const row = info.get(oid);
      if (!row) return [];
      const trackingNumber = firstString(row.trackingNumber, row.logisticsNo, row.expressNo);
      const shippedRaw = firstString(row.shippingTime, row.shipTime);
      const shipped = shippedRaw ? new Date(shippedRaw) : null;
      return [
        {
          platformOid: oid,
          trackingNumber: trackingNumber ?? null,
          carrier: firstString(row.carrier, row.logisticsChannel, row.channelName) ?? null,
          waybillUrl: null,
          shippedAt: shipped && !isNaN(shipped.getTime()) ? shipped : null,
        },
      ];
    });
  }
}

/** Interpret a creation-log row; null = outcome not expressed yet. */
function creationOutcome(log: FpPlaceOrderLog): { failed: boolean; reason?: string } | null {
  const reason = (log.failReason as string) || (log.message as string) || undefined;
  if (typeof log.success === "boolean") return { failed: !log.success, reason };
  if (typeof log.createSuccess === "boolean") return { failed: !log.createSuccess, reason };
  if (typeof log.status === "string") {
    const s = log.status.toUpperCase();
    if (["FAIL", "FAILED", "ERROR"].includes(s)) return { failed: true, reason };
    if (["SUCCESS", "SUCCEEDED", "CREATED"].includes(s)) return { failed: false };
  }
  if (typeof log.status === "number") {
    // Numeric creation status pending Apifox verification — only an explicit
    // failure marker should block; unknown values keep the optimistic path.
    return null;
  }
  return null;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}
