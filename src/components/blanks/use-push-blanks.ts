"use client";

import useSWR from "swr";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// Single home for all blanks-push request logic. The dialog, the order detail
// page, and the blanks page all call these — no fetch() duplication.

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface BlanksPrefill {
  factorySku: string;
  factorySize: string | null;
  factoryColor: string | null;
  factoryStyle: string | null;
  factoryCraftType: number | null;
}

export interface BlanksSupplierOption {
  id: string;
  key: string;
  name: string;
  adapterType: string;
}

export interface BlanksItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  vendor: string | null;
  normalizedVendor: string | null;
  designFileUrl: string | null;
  printEnabled: boolean;
  supplier: { id: string; key: string; name: string; adapterType: string } | null;
  unroutableReason: "no_vendor" | "unmapped_vendor" | "bad_supplier" | null;
  prefill: BlanksPrefill | null;
  /** SKU mapping prefills keyed by supplierId — used when switching an item
   * to an alternate supplier. */
  prefills: Record<string, BlanksPrefill>;
  supplierOrderNo: string | null;
  supplierPushedAt: string | null;
}

export interface BlanksPush {
  id: string;
  platformOid: string;
  supplierKey: string;
  supplierName: string;
  supplierAdapterType?: string;
  supplierConsoleUrl?: string | null;
  itemIds: string[];
  placedAt: string;
  pushedAt: string | null;
  orderStatus: number | null;
  orderStatusStr: string | null;
  statusSyncedAt: string | null;
  lastError: string | null;
}

export interface BlanksConsignee {
  name: string;
  phone: string;
  address: string;
  addressOptional: string;
  city: string;
  province: string;
  country: string;
  postCode: string;
}

export interface BlanksData {
  orderId: string;
  orderNumber: string | null;
  consignee: BlanksConsignee;
  consigneeMissing: string[];
  suppliers: BlanksSupplierOption[];
  items: BlanksItem[];
  pushes: BlanksPush[];
}

export interface PushBlanksItemPayload {
  orderItemId: string;
  supplierId?: string;
  factorySku: string;
  sizeCode?: string;
  sizeName?: string;
  colorCode?: string;
  colorName?: string;
  styleCode?: string;
  styleName?: string;
  craftType?: 1 | 2;
  shouldPrint: boolean;
  printPosition?: "1" | "2" | "1,2";
  imageUrls?: string[];
  effectImageUrls?: string[];
}

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

/** Fetch the dialog's data (blank items + routing + prefill + pushes). */
export function useBlanksData(orderId: string | null, enabled = true) {
  return useSWR<BlanksData>(
    enabled && orderId ? `/api/orders/${orderId}/blanks` : null,
    fetcher
  );
}

export interface CatalogSize {
  sizeName: string;
  productCode: string;
}
export interface CatalogColor {
  colorName: string;
  sizes: CatalogSize[];
}
export interface CatalogStyle {
  styleCode: string;
  styleName: string | null;
  colors: CatalogColor[];
}

/** Fetch a supplier's imported factory catalog (style/color/size picker). */
export function useSupplierCatalog(supplierId: string | null) {
  return useSWR<{ styles: CatalogStyle[] }>(
    supplierId ? `/api/suppliers/${supplierId}/catalog` : null,
    fetcher
  );
}

export function usePushBlanks() {
  const t = useTranslations("blanks");
  const [busy, setBusy] = useState(false);

  async function pushBlanks(
    orderId: string,
    mode: "place" | "place_and_push",
    items: PushBlanksItemPayload[],
    sellerRemark?: string,
    replace?: boolean,
    consignee?: BlanksConsignee
  ): Promise<{ results: BlanksGroupResult[] } | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/push-blanks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          items,
          sellerRemark: sellerRemark || undefined,
          replace: replace || undefined,
          consignee,
        }),
      });
      const data = await res.json();
      if (!res.ok && !Array.isArray(data.results)) {
        throw new Error(data.error || "Push failed");
      }
      return data as { results: BlanksGroupResult[] };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Push an already-placed supplier order (riin two-step) to the factory. */
  async function rePush(pushId: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/supplier-pushes/${pushId}/push`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push to factory failed");
      toast.success(t("toastPushedToFactory"));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push to factory failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Refresh supplier statuses — one order, or everything when omitted. */
  async function refreshStatus(orderId?: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/supplier-pushes/sync-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderId ? { orderId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status sync failed");
      const rejected = data.rejected > 0 ? t("toastRejectedSuffix", { count: data.rejected }) : "";
      toast.success(t("toastStatusRefreshed", { checked: data.checked, updated: data.updated }) + rejected);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status sync failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, pushBlanks, rePush, refreshStatus };
}
