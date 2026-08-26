"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Factory,
  Loader2,
  RefreshCw,
  Send,
  Settings,
  Shirt,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusBadge } from "@/components/orders/status-badge";
import { OmsPushDialog } from "@/components/orders/oms-push-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PushBlanksDialog } from "./push-blanks-dialog";
import { SupplierPushStatusBadge } from "./supplier-push-status-badge";
import { SupplierOrderLink } from "./supplier-order-link";
import { usePushBlanks, type BlanksPush } from "./use-push-blanks";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BlanksOrderRow {
  id: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  customerName: string | null;
  internalStatus: string;
  labelStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  shopifyCreatedAt: string | null;
  orderItems: {
    id: string;
    title: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
    vendor: string | null;
    printEnabled: boolean;
    supplierOrderNo: string | null;
    supplierPushedAt: string | null;
    shopifyFulfillmentOrderId: string | null;
  }[];
  shipments: {
    id: string;
    trackingNumber: string | null;
    carrier: string | null;
    providerName: string | null;
    shopifyFulfillmentOrderId: string | null;
    syncStatus: string;
    createdAt: string;
  }[];
  supplierPushes: (Omit<BlanksPush, "supplierKey" | "supplierName"> & {
    supplier: { id: string; key: string; name: string; adapterType: string; consoleUrl: string | null };
  })[];
}

interface RejectedSummary {
  pending: number;
  handling: number;
  resolved: number;
}

/** Our labels covering the blanks group: shipments scoped to a blanks
 * fulfillment group, or unscoped (whole order) when the blanks aren't split
 * into their own group. Excludes the transfer group's label on split orders,
 * and drops trackings the factory already reports (dedupe). */
function blanksOwnLabels(order: BlanksOrderRow) {
  const blankFoIds = new Set(
    order.orderItems.map((i) => i.shopifyFulfillmentOrderId).filter((v): v is string => !!v)
  );
  const factoryTrackings = new Set(
    order.supplierPushes.map((p) => p.trackingNumber).filter(Boolean)
  );
  return order.shipments.filter(
    (sh) =>
      sh.trackingNumber &&
      !factoryTrackings.has(sh.trackingNumber) &&
      (sh.shopifyFulfillmentOrderId === null || blankFoIds.has(sh.shopifyFulfillmentOrderId))
  );
}

const FILTERS = [
  { value: "all", labelKey: "filterAll" },
  { value: "unpushed", labelKey: "filterUnpushed" },
  { value: "placed", labelKey: "filterPlaced" },
  { value: "pushed", labelKey: "filterPushed" },
  { value: "rejected", labelKey: "filterRejected" },
] as const;

export function BlanksPage() {
  const t = useTranslations("blanks");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialogOrderId, setDialogOrderId] = useState<string | null>(null);
  const [omsPushOrderId, setOmsPushOrderId] = useState<string | null>(null);
  const [omsPushGroup, setOmsPushGroup] = useState<string | undefined>(undefined);
  const [splitting, setSplitting] = useState(false);

  const { busy, rePush, refreshStatus, syncShopify, setRejectionStatus } = usePushBlanks();

  const { data, isLoading, mutate } = useSWR<{
    orders: BlanksOrderRow[];
    total: number;
    totalPages: number;
    rejectedSummary?: RejectedSummary;
  }>(
    `/api/blanks-orders?page=${page}&filter=${filter}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
    fetcher
  );

  async function handleRefreshAll() {
    if (await refreshStatus()) mutate();
  }

  async function handleRefreshOrder(orderId: string) {
    if (await refreshStatus(orderId)) mutate();
  }

  async function handleRePush(pushId: string) {
    if (await rePush(pushId)) mutate();
  }

  async function handleSyncShopify(pushId: string) {
    if (await syncShopify(pushId)) mutate();
  }

  async function handleRejection(pushId: string, status: "handling" | "resolved") {
    if (await setRejectionStatus(pushId, status)) mutate();
  }

  /** Open the OMS label dialog for an order's blanks. Mixed orders are
   * auto-split first (blanks vs the rest) so the label attaches to the
   * blanks fulfillment group, not the transfer's. */
  async function openOmsForBlanks(orderId: string) {
    setSplitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/split-blanks`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Split failed");
      if (data.split) toast.success(t("autoSplitDone"));
      setOmsPushGroup(data.blanksFulfillmentOrderId ?? undefined);
      setOmsPushOrderId(orderId);
      if (data.split) mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Split failed");
    } finally {
      setSplitting(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Shirt className="h-5 w-5" />
          {t("title")}
        </h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefreshAll} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            {t("refreshAll")}
          </Button>
          <Link href="/blanks/settings">
            <Button size="sm" variant="ghost">
              <Settings className="h-3.5 w-3.5 mr-1" />
              {t("supplierSettings")}
            </Button>
          </Link>
        </div>
      </div>

      {(() => {
        const rs = data?.rejectedSummary;
        const open = (rs?.pending ?? 0) + (rs?.handling ?? 0);
        if (!rs || open === 0) return null;
        return (
          <div className="border border-red-300 bg-red-50 rounded-lg p-3 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="text-sm text-red-800 font-medium">
              {t("rejectedBanner", { count: open })}
            </span>
            <span className="text-xs text-red-700">
              {t("rejectedBannerDetail", { pending: rs.pending, handling: rs.handling })}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-700 ml-auto"
              onClick={() => {
                setPage(1);
                setFilter("rejected");
              }}
            >
              {t("rejectedBannerView")}
            </Button>
          </div>
        );
      })()}

      <div className="flex items-center gap-2 flex-wrap">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-48"
          />
          <Button type="submit" size="sm" variant="secondary">
            {t("search")}
          </Button>
        </form>
        <Select
          value={filter}
          onValueChange={(v) => {
            setPage(1);
            setFilter(v ?? "all");
          }}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {t(f.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && (
          <span className="text-xs text-muted-foreground">{t("orderCount", { count: data.total })}</span>
        )}
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colOrder")}</TableHead>
              <TableHead>{t("colOrderStatus")}</TableHead>
              <TableHead>{t("colItems")}</TableHead>
              <TableHead>{t("colSupplierStatus")}</TableHead>
              <TableHead>{t("colLabel")}</TableHead>
              <TableHead>{t("colStatusSync")}</TableHead>
              <TableHead className="text-right">{t("colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data?.orders ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                  {t("noOrders")}
                </TableCell>
              </TableRow>
            )}
            {(data?.orders ?? []).map((order) => (
              <TableRow key={order.id}>
                <TableCell className="align-top">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    #{order.shopifyOrderNumber ?? order.id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {order.customerName}
                    {order.shopifyCreatedAt && (
                      <> · {format(new Date(order.shopifyCreatedAt), "MM-dd")}</>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <StatusBadge status={order.internalStatus} className="text-[11px]" />
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-0.5">
                    {order.orderItems.map((item) => (
                      <div key={item.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                        <span className="truncate max-w-[220px]">{item.title}</span>
                        {item.variantTitle && (
                          <span className="font-medium text-purple-700">{item.variantTitle}</span>
                        )}
                        <span className="text-muted-foreground">× {item.quantity}</span>
                        {item.vendor && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {item.vendor}
                          </Badge>
                        )}
                        {item.printEnabled && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-700">
                            {t("printBadge")}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  {order.supplierPushes.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t("notPushed")}</span>
                  ) : (
                    <div className="space-y-1">
                      {order.supplierPushes.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium">{p.supplier.name}</span>
                          <SupplierOrderLink
                            platformOid={p.platformOid}
                            consoleUrl={p.supplier.consoleUrl}
                            className="text-xs"
                          />
                          <SupplierPushStatusBadge push={p} />
                          {p.orderStatus === 3 &&
                            ((p.rejectionStatus ?? "pending") === "pending" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[11px] px-2 border-red-300 text-red-700"
                                disabled={busy}
                                onClick={() => handleRejection(p.id, "handling")}
                              >
                                {t("rejectionStart")}
                              </Button>
                            ) : p.rejectionStatus === "handling" ? (
                              <>
                                <span className="text-[11px] text-blue-700">
                                  {t("rejectionHandlingBadge")}
                                  {p.rejectionHandledBy ? ` · ${p.rejectionHandledBy}` : ""}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-[11px] px-2 border-green-300 text-green-700"
                                  disabled={busy}
                                  onClick={() => handleRejection(p.id, "resolved")}
                                >
                                  {t("rejectionResolve")}
                                </Button>
                              </>
                            ) : (
                              <span className="text-[11px] text-green-700">
                                {t("rejectionResolvedBadge")}
                                {p.rejectionHandledBy ? ` · ${p.rejectionHandledBy}` : ""}
                              </span>
                            ))}
                          {!p.pushedAt &&
                            (p.supplier.adapterType === "linmiao" ? (
                              <span className="text-[11px] text-amber-700">
                                {t("awaitingLabel")}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[11px] px-2"
                                disabled={busy}
                                onClick={() => handleRePush(p.id)}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                {t("pushBtn")}
                              </Button>
                            ))}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-1">
                    {order.supplierPushes
                      .filter((p) => p.trackingNumber)
                      .map((p) => {
                        const shopifySynced = order.shipments.some(
                          (sh) => sh.trackingNumber === p.trackingNumber && sh.syncStatus === "SYNCED"
                        );
                        return (
                          <div key={p.id} className="space-y-0.5">
                            <span className="text-[11px] text-muted-foreground block">
                              {p.supplier.name}
                              {p.carrier ? ` · ${p.carrier}` : ""}
                            </span>
                            {p.waybillUrl ? (
                              <a
                                href={p.waybillUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-mono text-primary hover:underline block max-w-[140px] truncate"
                              >
                                {p.trackingNumber}
                              </a>
                            ) : (
                              <span className="text-xs font-mono block max-w-[140px] truncate">
                                {p.trackingNumber}
                              </span>
                            )}
                            {shopifySynced ? (
                              <span className="text-[10px] text-green-700">Shopify ✓</span>
                            ) : (
                              <button
                                className="text-[10px] text-primary hover:underline disabled:opacity-50"
                                disabled={busy}
                                onClick={() => handleSyncShopify(p.id)}
                              >
                                {t("syncShopify")}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    {blanksOwnLabels(order).map((sh) => (
                      <div key={sh.id} className="space-y-0.5">
                        <span className="text-[11px] text-muted-foreground block">
                          Label{sh.carrier ? ` · ${sh.carrier}` : ""}
                        </span>
                        <span className="text-xs font-mono block max-w-[140px] truncate">
                          {sh.trackingNumber}
                        </span>
                      </div>
                    ))}
                    {/* Always available — linmiao needs our label created
                        before the factory ships */}
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
                            <Tag className="h-3 w-3" />
                            {t("createLabel")}
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        }
                      />
                      <PopoverContent className="w-44 p-1" align="start">
                        <button
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                          onClick={() => {
                            const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
                            if (domain && order.shopifyOrderId) {
                              window.open(
                                `https://${domain}/admin/orders/${order.shopifyOrderId}`,
                                "_blank"
                              );
                            }
                          }}
                          disabled={!process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || !order.shopifyOrderId}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Shopify
                        </button>
                        <button
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                          disabled={splitting}
                          onClick={() => openOmsForBlanks(order.id)}
                        >
                          {splitting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Tag className="h-3.5 w-3.5" />
                          )}
                          OMS
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {order.supplierPushes.find((p) => p.statusSyncedAt)
                    ? format(
                        new Date(
                          Math.max(
                            ...order.supplierPushes
                              .filter((p) => p.statusSyncedAt)
                              .map((p) => new Date(p.statusSyncedAt!).getTime())
                          )
                        ),
                        "MM-dd HH:mm"
                      )
                    : "—"}
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    {order.supplierPushes.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title={t("refreshOrderTitle")}
                        disabled={busy}
                        onClick={() => handleRefreshOrder(order.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialogOrderId(order.id)}
                    >
                      <Factory className="h-3.5 w-3.5 mr-1" />
                      {t("pushBtn")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("prevPage")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("nextPage")}
          </Button>
        </div>
      )}

      {dialogOrderId && (
        <PushBlanksDialog
          orderId={dialogOrderId}
          open={!!dialogOrderId}
          onOpenChange={(open) => {
            if (!open) setDialogOrderId(null);
          }}
          onSuccess={() => mutate()}
        />
      )}

      {/* OMS label dialog — same shared component as the orders page */}
      {omsPushOrderId && (
        <OmsPushDialog
          orderId={omsPushOrderId}
          presetFulfillmentOrderId={omsPushGroup}
          open={!!omsPushOrderId}
          onOpenChange={(open) => {
            if (!open) {
              setOmsPushOrderId(null);
              setOmsPushGroup(undefined);
            }
          }}
          onSuccess={() => {
            setOmsPushOrderId(null);
            setOmsPushGroup(undefined);
            mutate();
          }}
        />
      )}
    </div>
  );
}
