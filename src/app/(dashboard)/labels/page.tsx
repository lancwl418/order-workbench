"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/orders/status-badge";
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
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { OrderListItem, PaginatedResponse } from "@/types";
import Link from "next/link";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Upload,
  Save,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useLabelsOrders(page: number, statusFilter: string) {
  const params = new URLSearchParams({
    page: String(page),
    limit: "25",
    sort: "createdAt",
    dir: "desc",
    view: "all",
  });
  if (statusFilter === "DONE") {
    params.set("printStatus", "DONE");
  } else if (statusFilter) {
    params.set("status", statusFilter);
  }

  const { data, isLoading, mutate } = useSWR<
    PaginatedResponse<OrderListItem>
  >(`/api/orders?${params.toString()}`, fetcher, {
    keepPreviousData: true,
  });

  return {
    orders: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    refresh: mutate,
  };
}

export default function LabelsPage() {
  const tLabels = useTranslations("labels");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("DONE");
  const { orders, pagination, isLoading, refresh } = useLabelsOrders(
    page,
    statusFilter
  );

  const [trackingInputs, setTrackingInputs] = useState<
    Record<string, string>
  >({});
  const [savingTracking, setSavingTracking] = useState<string | null>(null);
  const [syncingOrder, setSyncingOrder] = useState<string | null>(null);

  function handleTrackingChange(orderId: string, value: string) {
    setTrackingInputs((prev) => ({ ...prev, [orderId]: value }));
  }

  async function handleSaveTracking(order: OrderListItem) {
    const tracking = trackingInputs[order.id];
    if (!tracking || !tracking.trim()) {
      toast.error("Please enter a tracking number");
      return;
    }

    setSavingTracking(order.id);
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelStatus: "CREATED",
          internalStatus: "LABEL_CREATED",
        }),
      });

      if (!res.ok) throw new Error("Failed to update order");

      const shipmentRes = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          trackingNumber: tracking.trim(),
          sourceType: "MANUAL",
        }),
      });

      if (!shipmentRes.ok) throw new Error("Failed to create shipment");
      const shipment = await shipmentRes.json();

      toast.success(
        `Tracking saved for #${order.shopifyOrderNumber || order.id.slice(0, 8)}`
      );
      setTrackingInputs((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });

      // Auto-push fulfillment to Shopify
      try {
        const fulfillRes = await fetch("/api/fulfillment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipmentId: shipment.id }),
        });
        const fulfillData = await fulfillRes.json();
        if (fulfillRes.ok) {
          toast.success(`Synced to Shopify`);
        } else {
          toast.error(`Shopify sync: ${fulfillData.error || fulfillData.details || "Failed"}`);
        }
      } catch {
        toast.error("Shopify sync failed");
      }

      refresh();
    } catch {
      toast.error("Failed to save tracking number");
    } finally {
      setSavingTracking(null);
    }
  }

  async function handleSyncToShopify(order: OrderListItem) {
    setSyncingOrder(order.id);
    try {
      // Find the shipment for this order to push fulfillment
      const shipmentsRes = await fetch(`/api/shipments?orderId=${order.id}`);
      const shipments = await shipmentsRes.json();
      const shipment = shipments?.find(
        (s: { trackingNumber: string | null }) => s.trackingNumber
      );

      if (!shipment) {
        toast.error("No shipment with tracking number found");
        return;
      }

      const res = await fetch("/api/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: shipment.id }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || data.details || "Failed to sync");

      toast.success(
        `Order #${order.shopifyOrderNumber || order.id.slice(0, 8)} synced to Shopify`
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sync to Shopify");
    } finally {
      setSyncingOrder(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{tLabels("labelStatus")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tLabels("manageLabels")}
          </p>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v) {
              setStatusFilter(v);
              setPage(1);
            }
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DONE">
              {tLabels("printDone")}
            </SelectItem>
            <SelectItem value="LABEL_CREATED">
              {tStatus("LABEL_CREATED")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tLabels("columns.orderNumber")}</TableHead>
              <TableHead className="hidden sm:table-cell">{tLabels("columns.customer")}</TableHead>
              <TableHead className="hidden md:table-cell">{tLabels("columns.route")}</TableHead>
              <TableHead>{tLabels("columns.labelStatus")}</TableHead>
              <TableHead>{tLabels("columns.tracking")}</TableHead>
              <TableHead className="hidden md:table-cell">{tLabels("columns.date")}</TableHead>
              <TableHead>{tLabels("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {tCommon("loading")}
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {tLabels("noOrdersInStatus")}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const isSavingThis = savingTracking === order.id;
                const isSyncingThis = syncingOrder === order.id;

                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        #
                        {order.shopifyOrderNumber || order.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="max-w-[120px] truncate">
                        {order.customerName || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {order.shippingRoute === "NOT_ASSIGNED" ? (
                        <span className="text-muted-foreground text-sm">
                          -
                        </span>
                      ) : (
                        <StatusBadge status={order.shippingRoute} />
                      )}
                    </TableCell>
                    <TableCell>
                      {order.labelStatus === "NOT_CREATED" ? (
                        <span className="text-muted-foreground text-sm">
                          -
                        </span>
                      ) : (
                        <StatusBadge status={order.labelStatus} />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono max-w-[120px] truncate block">
                        {order.trackingNumber || "-"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {formatDate(order.shopifyCreatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!order.trackingNumber && (
                          <>
                            <Input
                              placeholder={tLabels("trackingPlaceholder")}
                              className="h-7 w-[100px] sm:w-[140px] text-xs"
                              value={trackingInputs[order.id] || ""}
                              onChange={(e) =>
                                handleTrackingChange(
                                  order.id,
                                  e.target.value
                                )
                              }
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                isSavingThis ||
                                !trackingInputs[order.id]?.trim()
                              }
                              onClick={() => handleSaveTracking(order)}
                            >
                              {isSavingThis ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3" />
                              )}
                            </Button>
                          </>
                        )}
                        {order.trackingNumber &&
                          order.labelStatus !== "SYNCED_TO_SHOPIFY" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isSyncingThis}
                              onClick={() => handleSyncToShopify(order)}
                            >
                              {isSyncingThis ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Upload className="h-3 w-3" />
                              )}
                              {tLabels("syncToShopify")}
                            </Button>
                          )}
                        {order.labelStatus === "SYNCED_TO_SHOPIFY" && (
                          <span className="text-xs text-green-600 font-medium">
                            {tLabels("synced")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between py-4">
          <div className="hidden sm:block text-sm text-muted-foreground">
            {tCommon("showing")} {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} {tCommon("of")}{" "}
            {pagination.total}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
