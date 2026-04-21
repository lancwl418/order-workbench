import { createHash } from "crypto";

const DEFAULT_BASE_URL = "https://linmiao.online/";

function baseUrl(): string {
  const raw = process.env.FACTORY_API_URL || DEFAULT_BASE_URL;
  return raw.endsWith("/") ? raw : raw + "/";
}

function secretKey(): string {
  const key = process.env.FACTORY_API_SECRET_KEY;
  if (!key) {
    throw new Error(
      "FACTORY_API_SECRET_KEY is not set. Configure the factory API env vars to use this feature."
    );
  }
  return key;
}

function sign(body: string, key: string): string {
  return createHash("md5").update(body + "::" + key).digest("hex");
}

export interface FactoryResponse<T = unknown> {
  successful: boolean;
  message: string;
  errorCode: string;
  data: T;
  traceId: string;
}

async function post<T>(path: string, payload: Record<string, unknown>): Promise<FactoryResponse<T>> {
  const key = secretKey();
  const body = JSON.stringify(payload);
  const url = baseUrl() + path.replace(/^\//, "");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      secretKey: key,
      sign: sign(body, key),
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Factory HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  let parsed: FactoryResponse<T>;
  try {
    parsed = JSON.parse(text) as FactoryResponse<T>;
  } catch {
    throw new Error(`Factory returned non-JSON response: ${text.slice(0, 500)}`);
  }

  if (!parsed.successful) {
    const err = new Error(parsed.message || parsed.errorCode || "Factory push failed");
    (err as Error & { traceId?: string; errorCode?: string }).traceId = parsed.traceId;
    (err as Error & { traceId?: string; errorCode?: string }).errorCode = parsed.errorCode;
    throw err;
  }

  return parsed;
}

// ─── Payload types ──────────────────────────────────────────────

export interface FactoryConsignee {
  name: string;
  phone: string;
  address: string;
  alternateAddress?: string;
  country: string;
  province: string;
  city: string;
  district?: string;
  town?: string;
  company?: string;
  id?: string;
  postCode?: string;
}

export interface FactoryImage {
  type: 1 | 2; // 1=打印图, 2=效果图
  imageUrl: string;
  imageCode: string;
  imageName: string;
}

export interface FactoryGoodsItem {
  pfOrderId: string;
  pfSubOrderId: string;
  goodsType: 1 | 2;
  title: string;
  specification: string;
  subOrderStatus: "NOT_SHIPPED" | "SHIPPED";
  subOrderRefundStatus: "NO_REFUND" | "REFUNDING" | "PART_REFUNDED" | "REFUNDED";
  sizeCode: string;
  sizeName: string;
  colorCode: string;
  colorName: string;
  styleCode: string;
  styleName: string;
  craftType: 1 | 2;
  num: number;
  spuId?: string;
  skuId?: string;
  remark?: string;
  price?: number;
  sellPrice?: number;
  printPosition?: string;
  imageList: FactoryImage[];
}

export interface FactoryCreateOrderParams {
  platformType: 15 | 18;
  sourceOrderId: string;
  pfOrderStatus: "NOT_SHIPPED" | "SHIPPED" | "CANCEL";
  pfRefundStatus: "NO_REFUND" | "REFUNDING" | "PART_REFUNDED" | "REFUNDED";
  pfOrderId: string;
  consignee: FactoryConsignee;
  orderTime: string;
  postCode?: string;
  goodsList: FactoryGoodsItem[];
  sellerRemark?: string;
  buyerRemark?: string;
}

// ─── API methods ───────────────────────────────────────────────

export function createOrder(params: FactoryCreateOrderParams): Promise<FactoryResponse<unknown>> {
  return post("trade/v1/openapi/create-order", params as unknown as Record<string, unknown>);
}

export function updateOrder(params: Omit<FactoryCreateOrderParams, "platformType" | "orderTime"> & { goodsUpdateList: FactoryGoodsItem[] }): Promise<FactoryResponse<unknown>> {
  return post("trade/v1/openapi/update-order", params as unknown as Record<string, unknown>);
}

export function queryOrderStatus(orderIds: string[]): Promise<FactoryResponse<unknown>> {
  return post("trade/v1/openapi/query-order-status", { orderIdList: orderIds });
}
