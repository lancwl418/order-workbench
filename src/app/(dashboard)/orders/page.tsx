"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useOrders } from "@/hooks/use-orders";
import { DataTable } from "@/components/orders/data-table";
import { createColumns } from "@/components/orders/columns";
import { OrderFilterBar } from "@/components/orders/order-filters";
import { BulkActions } from "@/components/orders/bulk-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { OrderListItem } from "@/types";
import {
  RefreshCw,
  Loader2,
  Printer,
  Truck,
  AlertTriangle,
  Package,
  CheckCircle2,
  PackageX,
  Clock,
} from "lucide-react";
import Link from "next/link";

type StatusCounts = Record<string, number>;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useStatusCounts() {
  const { data, mutate } = useSWR<StatusCounts>(
    "/api/orders/counts",
    fetcher,
    { refreshInterval: 30000 }
  );
  return { counts: data || {}, refreshCounts: mutate };
}

const summaryCardDefs: {
  key: string;
  labelKey: string;
  icon: typeof Package;
  color: string;
  bg: string;
  href?: string;
  status?: string;
}[] = [
  { key: "OPEN", labelKey: "open", icon: Package, color: "text-slate-600", bg: "bg-slate-50", status: "OPEN" },
  { key: "_printInQueue", labelKey: "inPrintQueue", icon: Printer, color: "text-purple-600", bg: "bg-purple-50", href: "/print-queue" },
  { key: "_printDone", labelKey: "printDone", icon: CheckCircle2, color: "text-cyan-600", bg: "bg-cyan-50" },
  { key: "SHIPPED", labelKey: "shipped", icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", status: "SHIPPED" },
  { key: "_shipmentIssues", labelKey: "shipmentIssues", icon: PackageX, color: "text-orange-600", bg: "bg-orange-50", href: "/exceptions?category=shipment" },
  { key: "_processingDelays", labelKey: "processingDelays", icon: Clock, color: "text-purple-600", bg: "bg-purple-50", href: "/exceptions?category=processing" },
  { key: "_total", labelKey: "totalOrders", icon: Package, color: "text-slate-600", bg: "bg-slate-50" },
];

export default function OrdersPage() {
  const tOrders = useTranslations("orders");
  const tStatus = useTranslations("status");
  const tPrint = useTranslations("printStatus");
  const tSummary = useTranslations("summary");

  const {
    orders,
    pagination,
    isLoading,
    filters,
    setPage,
    setSearch,
    setStatus,
    setShippingRoute,
    resetFilters,
    refresh,
  } = useOrders();

  const { counts, refreshCounts } = useStatusCounts();
  const [selectedOrders, setSelectedOrders] = useState<OrderListItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [statusLoading, setStatusLoading] = useState<string | null>(null);

  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: string) => {
      setStatusLoading(orderId);
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ internalStatus: newStatus }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success(`Status → ${tStatus.has(newStatus) ? tStatus(newStatus) : newStatus}`);
        await Promise.all([refresh(), refreshCounts()]);
      } catch {
        toast.error("Failed to update status");
      } finally {
        setStatusLoading(null);
      }
    },
    [refresh, refreshCounts, tStatus]
  );

  const handlePrintStatusChange = useCallback(
    async (orderId: string, newPrintStatus: string) => {
      setStatusLoading(orderId);
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ printStatus: newPrintStatus }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success(`Print status → ${tPrint.has(newPrintStatus) ? tPrint(newPrintStatus) : newPrintStatus}`);
        await Promise.all([refresh(), refreshCounts()]);
      } catch {
        toast.error("Failed to update print status");
      } finally {
        setStatusLoading(null);
      }
    },
    [refresh, refreshCounts, tPrint]
  );

  const handleCsToggle = useCallback(
    async (orderId: string, csFlag: boolean) => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csFlag }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success(csFlag ? "Flagged as CS order" : "CS flag removed");
        refresh();
      } catch {
        toast.error("Failed to update CS flag");
      }
    },
    [refresh]
  );

  // Build print status label map for columns
  const printLabels: Record<string, string> = {};
  for (const s of ["NONE", "READY", "IN_QUEUE", "GROUPED", "DONE"]) {
    printLabels[s] = tPrint.has(s) ? tPrint(s) : s;
  }

  const columns = useMemo(
    () =>
      createColumns({
        onStatusChange: handleStatusChange,
        onPrintStatusChange: handlePrintStatusChange,
        onCsToggle: handleCsToggle,
        loadingId: statusLoading,
        shopifyStoreDomain: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN,
        t: {
          orderNumber: tOrders("columns.orderNumber"),
          customer: tOrders("columns.customer"),
          date: tOrders("columns.date"),
          total: tOrders("columns.total"),
          items: tOrders("columns.items"),
          orderStatus: tOrders("columns.orderStatus"),
          tracking: tOrders("columns.tracking"),
          printStatus: tOrders("columns.printStatus"),
          createLabel: tOrders("createLabel"),
          comingSoon: tOrders("comingSoon"),
          noPrint: "No Print",
          addToQueue: "Add to Queue",
          reprintAddToQueue: "Reprint / Add to Queue",
          printLabels,
          csRemove: "Remove CS flag",
          csFlag: "Flag as CS order",
        },
      }),
    [handleStatusChange, handlePrintStatusChange, handleCsToggle, statusLoading, tOrders, printLabels]
  );

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/orders/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      toast.success(
        `Synced ${data.summary.fetched} orders (${data.summary.created} new, ${data.summary.updated} updated)`
      );
      await Promise.all([refresh(), refreshCounts()]);
    } catch {
      toast.error(
        "Failed to sync from Shopify. Check your Shopify configuration."
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">{tOrders("title")}</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {syncing ? tOrders("syncing") : tOrders("syncFromShopify")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        {summaryCardDefs.map((card) => {
          const Icon = card.icon;
          const count = counts[card.key] ?? 0;
          const isClickable = !!(card.href || card.status);
          const isActive = card.status && filters.status === card.status;
          const label = tSummary.has(card.labelKey) ? tSummary(card.labelKey) : card.labelKey;
          const content = (
            <Card
              key={card.key}
              className={`${isClickable ? "cursor-pointer hover:shadow-md transition-shadow" : "cursor-default"} ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`p-1.5 rounded-md ${card.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${card.color}`} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {label}
                  </span>
                </div>
                <p className="text-2xl font-semibold">{count}</p>
              </CardContent>
            </Card>
          );
          if (card.href) {
            return (
              <Link key={card.key} href={card.href}>
                {content}
              </Link>
            );
          }
          if (card.status) {
            return (
              <div
                key={card.key}
                onClick={() =>
                  setStatus(filters.status === card.status ? "" : card.status!)
                }
              >
                {content}
              </div>
            );
          }
          return <div key={card.key}>{content}</div>;
        })}
      </div>

      <OrderFilterBar
        filters={filters}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
        onRouteChange={setShippingRoute}
        onReset={resetFilters}
      />

      <BulkActions
        selectedOrders={selectedOrders}
        onComplete={async () => {
          setSelectedOrders([]);
          await Promise.all([refresh(), refreshCounts()]);
        }}
      />

      <DataTable
        columns={columns}
        data={orders}
        pagination={pagination}
        onPageChange={setPage}
        onRowSelectionChange={(rows) =>
          setSelectedOrders(rows as OrderListItem[])
        }
        isLoading={isLoading}
      />
    </div>
  );
}
