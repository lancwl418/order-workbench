import type { Supplier } from "@prisma/client";

// ─── Unified order input (adapter-agnostic) ─────────────────────

export interface SupplierConsignee {
  name: string;
  phone: string;
  address: string;
  addressOptional?: string;
  country: string;
  province: string;
  city: string;
  district?: string;
  town?: string;
  postCode?: string;
}

export interface SupplierOrderItemInput {
  orderItemId: string;
  title: string;
  quantity: number;
  price: number;
  ourSku: string | null;
  factorySku: string;
  sizeCode: string;
  sizeName: string;
  colorCode: string;
  colorName: string;
  styleCode: string;
  styleName: string;
  craftType: 1 | 2; // 1=白墨烫画 (default for blanks), 2=白墨直喷
  shouldPrint: boolean;
  printPosition?: "1" | "2" | "1,2";
  printImageUrls: string[];
  effectImageUrls: string[];
}

export interface SupplierOrderInput {
  /** Our generated supplier-side order number (unique per push). */
  platformOid: string;
  /** Internal order id, sent as the source platform order id. */
  sourceOrderId: string;
  consignee: SupplierConsignee;
  orderTime: Date;
  sellerRemark?: string;
  items: SupplierOrderItemInput[];
}

// ─── Results ────────────────────────────────────────────────────

export interface SupplierOrderResult {
  platformOid: string;
  traceId?: string;
  /** True once the order reached the factory (riin: pushOrder succeeded). */
  pushed: boolean;
  /** Set when placing succeeded but the factory push step failed. */
  pushError?: string;
  raw?: unknown;
}

export interface SupplierPushToFactoryResult {
  succeeded: string[];
  failed: { platformOid: string; reason: string }[];
  traceId?: string;
}

export interface SupplierOrderStatus {
  platformOid: string;
  orderStatus: number | null;
  orderStatusStr: string | null;
}

export interface SupplierDelivery {
  platformOid: string;
  trackingNumber: string | null;
  carrier: string | null;
  waybillUrl: string | null;
  shippedAt: Date | null;
}

// ─── Adapter contract ───────────────────────────────────────────

export interface SupplierAdapter {
  readonly supplier: Supplier;
  /**
   * Place an order at the supplier. When push is true the adapter also
   * forwards it to the factory (riin two-step; linmiao orders go straight
   * to the factory, so push is implicit there).
   */
  placeOrder(input: SupplierOrderInput, opts: { push: boolean }): Promise<SupplierOrderResult>;
  /** Push already-placed orders to the factory. No-op for linmiao. */
  pushToFactory(platformOids: string[]): Promise<SupplierPushToFactoryResult>;
  /** Query current order statuses (riin enum 1..15). */
  queryStatus(platformOids: string[]): Promise<SupplierOrderStatus[]>;
  /** Query factory-side shipment info (tracking number, waybill, ship time). */
  queryDelivery(platformOids: string[]): Promise<SupplierDelivery[]>;
}

// ─── riin order status enum (shared by UI + sync) ───────────────

export const RIIN_ORDER_STATUS: Record<number, string> = {
  1: "店铺审核中",
  2: "店铺推送中",
  3: "反审回电商",
  4: "工厂审核",
  5: "生产中",
  12: "已发货",
  13: "已关闭",
  14: "退款中",
  15: "已退款",
};

/** Statuses that no longer change — the status sync skips these. */
export const TERMINAL_ORDER_STATUSES = [12, 13, 15];

/** Sent back by the factory — needs operator attention. */
export const REJECTED_ORDER_STATUS = 3;

/** Shipped — delivery/tracking becomes available at this status. */
export const SHIPPED_ORDER_STATUS = 12;

/** Normalized form used as the VendorMapping key. */
export function normalizeVendor(vendor: string): string {
  return vendor.trim().toLowerCase();
}

/**
 * Factories compose their product code as styleCode-colorCode-sizeCode. When
 * no explicit style code is given we fall back to the factory SKU — but SKUs
 * like "T001-Dark Blue-M" already end in color/size, which the factory would
 * duplicate ("T001-Dark Blue-M-Dark Blue-M"). Strip a trailing color/size
 * suffix so the fallback is just the style part.
 */
export function deriveStyleCode(factorySku: string, colorCode: string, sizeCode: string): string {
  // Segment-based, space-insensitive: "T1-White-onesize" with size "One Size"
  // still strips down to "T1" (the variant may spell the size differently
  // than the SKU segment).
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "");
  const targets = [norm(colorCode), norm(sizeCode)].filter(Boolean);
  const parts = factorySku.trim().split("-");
  while (parts.length > 1 && targets.includes(norm(parts[parts.length - 1]))) {
    parts.pop();
  }
  return parts.join("-") || factorySku.trim();
}

/**
 * The "[不打印]" marker still needs a non-empty, fetchable imageUrl (linmiao
 * rejects empty ones with "图片url不能为空"). Prefer the item's own images;
 * fall back to a configurable placeholder.
 */
export function noPrintMarkerUrl(item: { effectImageUrls: string[]; printImageUrls: string[] }): string {
  return (
    item.effectImageUrls[0] ??
    item.printImageUrls[0] ??
    process.env.BLANKS_PLACEHOLDER_IMAGE_URL ??
    "https://placehold.co/200x200.png"
  );
}

/** yyyy-MM-dd HH:mm:ss — the timestamp format both supplier APIs expect. */
export function formatOrderTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
