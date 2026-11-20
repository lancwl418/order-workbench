import { createHmac, randomUUID } from "crypto";

// Raw client for the FP ERP Open API (Linglu-ERP-OpenApi), the system
// Xinfeiyang switched to in 2026-11. See docs/blanks-push-plan.md (FP section)
// and "FP ERP Open API Integration Guide - EN".
//
// Protocol: every request is POST {baseUrl}/openApi/{endpoint} with a JSON
// body carrying appKey / timestamp(ms) / requestId / signature. The signature
// is Base64(HmacSHA256(signText, secret)) where signText flattens all
// non-null fields (objects as a.b, arrays as items[0]), sorts keys
// lexicographically and joins as key=value&key=value. placeOrder is
// ASYNCHRONOUS — acceptance ≠ creation; confirm via listPlaceOrderLog,
// listOrderInfo or the status webhook.

export interface FpResponse<T = unknown> {
  successFlag: boolean;
  errorCode?: string;
  message?: string;
  data: T;
  traceId?: string;
}

export class FpApiError extends Error {
  traceId?: string;
  errorCode?: string;
  constructor(message: string, traceId?: string, errorCode?: string) {
    super(message);
    this.name = "FpApiError";
    this.traceId = traceId;
    this.errorCode = errorCode;
  }
}

// ─── Signature (exported for tests) ─────────────────────────────

/**
 * Flatten a JSON value into signText pairs: objects use dot notation (a.b),
 * arrays use index notation (items[0]); null/undefined values are skipped;
 * booleans serialize as true/false.
 */
export function flattenFpParams(
  value: unknown,
  prefix = "",
  result: Record<string, string> = {}
): Record<string, string> {
  if (value === null || value === undefined) return result;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      flattenFpParams(item, prefix === "" ? `[${i}]` : `${prefix}[${i}]`, result);
    });
    return result;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      flattenFpParams(item, prefix === "" ? key : `${prefix}.${key}`, result);
    }
    return result;
  }
  result[prefix] = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  return result;
}

/**
 * Drop null/undefined/empty-string fields (deep) before signing + sending.
 * FP's verifier ignores blank values when rebuilding signText, so a blank
 * field we signed as `key=` (e.g. addressLine2 "") fails with 验签不通过.
 * Omitting blanks from the body keeps both sides' signText identical.
 */
export function pruneFpBlanks<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => pruneFpBlanks(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined || v === "") continue;
      out[k] = pruneFpBlanks(v);
    }
    return out as T;
  }
  return value;
}

/** Build the canonical signText for a request body (signature field excluded). */
export function buildFpSignText(body: Record<string, unknown>): string {
  const { signature: _signature, ...rest } = body;
  const flat = flattenFpParams(rest);
  return Object.keys(flat)
    .sort()
    .map((k) => `${k}=${flat[k]}`)
    .join("&");
}

export function signFpRequest(body: Record<string, unknown>, secret: string): string {
  return createHmac("sha256", secret).update(buildFpSignText(body), "utf8").digest("base64");
}

// ─── Request/response shapes (doc section 7) ────────────────────

// IMPORTANT: FP verifies the signature against its typed request model, not
// the raw JSON. Only fields listed in the Apifox schema may be sent — any
// extra field (and any model default we omit, e.g. currencyType) changes
// the server-side signText and fails with 验签不通过.

/** ProductionImage (Apifox schema). */
export interface FpProductionImage {
  printCode: string;
  productionImageName: string;
  /** Print width in cm. */
  widthInBlueMask?: number;
  /** Effect image URL. */
  thumbUrl?: string;
  thumbImageName?: string;
}

/** OrderGoods (Apifox schema). goodsName is required by FP. */
export interface FpOrderGoodsItem {
  /** 0=finished design, 1=product+image, 2=no-process product */
  goodsMode: 0 | 1 | 2;
  quantity: number;
  finishedProductDetailId?: string;
  systemSku?: string;
  productProcessId?: number; // -1 none, 1 white ink ironing, 2 DTG
  goodsName: string;
  productionImages?: FpProductionImage[];
}

export interface FpPlaceOrderParams {
  platformOid: string;
  shopName?: string;
  orderCreateTime?: string;
  latestShipTime?: string;
  recipientLastName: string;
  recipientFirstName: string;
  recipientPhone: string;
  recipientPostCode: string;
  recipientCity: string;
  recipientState: string;
  recipientCountry: string;
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  /** Documented: 0=system logistics, 1=own label (delayed upload), 4=own
   * label. 2/3 are undocumented — the enum skips them and the FP console has
   * a self-pickup mode the open API docs don't expose. */
  logisticsType: 0 | 1 | 2 | 3 | 4;
  saleCountry: string;
  currencyType?: string;
  orderGoodsList: FpOrderGoodsItem[];
}

/** listOrderInfo row — field names defensive until verified against Apifox. */
export interface FpOrderInfo {
  platformOid: string;
  orderStatus?: number;
  detailStatus?: number;
  trackingNumber?: string;
  logisticsNo?: string;
  expressNo?: string;
  logisticsChannel?: string;
  channelName?: string;
  carrier?: string;
  shippingTime?: string;
  shipTime?: string;
  pushTime?: string;
  [k: string]: unknown;
}

/** OpenApiPlaceOrderLogResponse (Apifox "16-查询异步下单结果"). */
export interface FpPlaceOrderLog {
  platformOid: string;
  /** 0 = pending, 1 = success, 2 = failed */
  status?: number;
  statusName?: string;
  failReason?: string;
  createTime?: string;
  updateTime?: string;
  [k: string]: unknown;
}

export class FpClient {
  private readonly baseUrl: string;
  private readonly appKey: string;
  private readonly secret: string;

  constructor(opts: { appKey: string; secret: string; baseUrl?: string | null }) {
    if (!opts.appKey) throw new Error("FP appKey is empty — configure the supplier's appKey env var");
    if (!opts.secret) throw new Error("FP secret is empty — configure the supplier's secret env var");
    this.appKey = opts.appKey;
    this.secret = opts.secret;
    const raw = opts.baseUrl || process.env.FP_API_URL;
    if (!raw) {
      throw new Error("FP base URL missing — set the supplier's baseUrl or the FP_API_URL env var");
    }
    this.baseUrl = raw.replace(/\/+$/, "");
  }

  private async post<T>(endpoint: string, payload: Record<string, unknown>): Promise<FpResponse<T>> {
    const body: Record<string, unknown> = {
      ...pruneFpBlanks(payload),
      appKey: this.appKey,
      timestamp: Date.now(),
      requestId: `owb_${randomUUID().replace(/-/g, "").slice(0, 28)}`,
    };
    body.signature = signFpRequest(body, this.secret);

    const url = `${this.baseUrl}/openApi/${endpoint}`;
    const REQUEST_TIMEOUT_MS = 30_000;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new FpApiError(`FP API timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${endpoint})`);
      }
      throw new FpApiError(`FP API unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }

    const text = await res.text();
    if (!res.ok) {
      // 404/405 usually means the /ecommerce path prefix is missing (doc §10)
      throw new FpApiError(
        `FP HTTP ${res.status} (${endpoint})${res.status === 404 || res.status === 405 ? " — check the /ecommerce base path" : ""}: ${text.slice(0, 500)}`
      );
    }

    let parsed: FpResponse<T>;
    try {
      parsed = JSON.parse(text) as FpResponse<T>;
    } catch {
      throw new FpApiError(`FP returned non-JSON response: ${text.slice(0, 500)}`);
    }
    if (!parsed.successFlag) {
      throw new FpApiError(
        parsed.message || parsed.errorCode || "FP request failed",
        parsed.traceId,
        parsed.errorCode
      );
    }
    return parsed;
  }

  /** Asynchronous — acceptance only. Confirm via listPlaceOrderLog/webhook. */
  placeOrder(params: FpPlaceOrderParams): Promise<FpResponse<unknown>> {
    return this.post("placeOrder", params as unknown as Record<string, unknown>);
  }

  /** Only valid for orders at orderStatus=150 (ready to push). */
  batchPushOrder(platformOidList: string[]): Promise<FpResponse<unknown>> {
    return this.post("batchPushOrder", { platformOidList });
  }

  listOrderInfo(platformOidList: string[], page = { pageIndex: 1, pageSize: 100 }): Promise<FpResponse<FpOrderInfo[] | { list?: FpOrderInfo[]; records?: FpOrderInfo[] } | null>> {
    return this.post("listOrderInfo", { platformOidList, ...page });
  }

  listPlaceOrderLog(platformOidList: string[]): Promise<FpResponse<FpPlaceOrderLog[] | { list?: FpPlaceOrderLog[]; records?: FpPlaceOrderLog[] } | null>> {
    // pageIndex/pageSize default to 1/20 in FP's request model and are part
    // of its signText — omitting them fails 验签 (same rule as placeOrder).
    return this.post("listPlaceOrderLog", {
      platformOidList,
      pageIndex: 1,
      pageSize: Math.max(platformOidList.length, 20),
    });
  }

  /**
   * Upload a production/thumb image into the FP asset center. The exact
   * schema needs verification against Apifox during联调 — current assumption:
   * URL-based upload with a folder + target name.
   */
  uploadMaterialImage(params: {
    materialImageFolderName?: string;
    imageName: string;
    imageUrl: string;
  }): Promise<FpResponse<unknown>> {
    return this.post("uploadMaterialImage", params);
  }

  uploadDelayShippingLabel(params: {
    platformOid: string;
    labelUrl?: string;
    trackingNumber?: string;
    carrier?: string;
    [k: string]: unknown;
  }): Promise<FpResponse<unknown>> {
    return this.post("uploadDelayShippingLabel", params);
  }

  getSupplierAddressList(): Promise<FpResponse<unknown>> {
    return this.post("getSupplierAddressList", {});
  }

  querySpuList(params: { pageNum?: number; pageSize?: number; distributionCountry?: string } = {}): Promise<FpResponse<unknown>> {
    return this.post("querySpuList", params);
  }

  querySpuInfo(spuIds: string[], distributionCountry?: string): Promise<FpResponse<unknown>> {
    return this.post("querySpuInfo", { spuIds, distributionCountry });
  }

  queryPrintPosition(params: Record<string, unknown> = {}): Promise<FpResponse<unknown>> {
    return this.post("queryPrintPosition", params);
  }

  getSkuStockInfo(params: Record<string, unknown>): Promise<FpResponse<unknown>> {
    return this.post("getSkuStockInfo", params);
  }

  pushOrderStatusWebhook(platformOidList: string[]): Promise<FpResponse<unknown>> {
    return this.post("pushOrderStatusWebhook", { platformOidList });
  }
}
