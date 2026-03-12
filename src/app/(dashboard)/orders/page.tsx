"use client";

import { useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import { useOrders } from "@/hooks/use-orders";
import { DataTable } from "@/components/orders/data-table";
import { createColumns } from "@/components/orders/columns";
import { OrderFilterBar } from "@/components/orders/order-filters";
import { BulkActions } from "@/components/orders/bulk-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_LABELS } from "@/lib/constants";
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

const summaryCards = [
  {
    key: "READY_TO_PRINT",
    label: "Ready to Print",
    icon: Printer,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
  {
    key: "PRINTING",
    label: "Printing",
    icon: Loader2,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  {
    key: "READY_TO_SHIP",
    label: "Ready to Ship",
    icon: Truck,
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
  {
    key: "SHIPPED",
    label: "Shipped",
    icon: CheckCircle2,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    key: "_shipmentIssues",
    label: "Shipment Issues",
    icon: PackageX,
    color: "text-orange-600",
    bg: "bg-orange-50",
    href: "/exceptions?category=shipment",
  },
  {
    key: "_processingDelays",
    label: "Processing Delays",
    icon: Clock,
    color: "text-purple-600",
    bg: "bg-purple-50",
    href: "/exceptions?category=processing",
  },
  {
    key: "_total",
    label: "Total Orders",
    icon: Package,
    color: "text-slate-600",
    bg: "bg-slate-50",
  },
];

export default function OrdersPage() {
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
        toast.success(`Status → ${STATUS_LABELS[newStatus]}`);
        await Promise.all([refresh(), refreshCounts()]);
      } catch {
        toast.error("Failed to update status");
      } finally {
        setStatusLoading(null);
      }
    },
    [refresh, refreshCounts]
  );

  const columns = useMemo(
    () =>
      createColumns({
        onStatusChange: handleStatusChange,
        loadingId: statusLoading,
      }),
    [handleStatusChange, statusLoading]
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
        <h1 className="text-2xl font-semibold">Order Workbench</h1>
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
          {syncing ? "Syncing..." : "Sync from Shopify"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const count = counts[card.key] ?? 0;
          const content = (
            <Card key={card.key} className={(card as { href?: string }).href ? "cursor-pointer hover:shadow-md transition-shadow" : "cursor-default"}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`p-1.5 rounded-md ${card.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${card.color}`} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {card.label}
                  </span>
                </div>
                <p className="text-2xl font-semibold">{count}</p>
              </CardContent>
            </Card>
          );
          const href = (card as { href?: string }).href;
          return href ? (
            <Link key={card.key} href={href}>
              {content}
            </Link>
          ) : (
            <div key={card.key}>{content}</div>
          );
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
