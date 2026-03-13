"use client";

import { useState } from "react";
import useSWR from "swr";
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
import { STATUS_LABELS } from "@/lib/constants";
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
      // Update the order with tracking number and set label status
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelStatus: "CREATED",
          internalStatus: "LABEL_CREATED",
        }),
      });

      if (!res.ok) throw new Error("Failed to update order");

      // If there are existing shipments, update the first one
      // Otherwise create a new shipment with the tracking number
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

      toast.success(
        `Tracking saved for #${order.shopifyOrderNumber || order.id.slice(0, 8)}`
      );
      setTrackingInputs((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
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
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelStatus: "SYNCED_TO_SHOPIFY",
        }),
      });

      if (!res.ok) throw new Error("Failed to sync");

      toast.success(
        `Order #${order.shopifyOrderNumber || order.id.slice(0, 8)} synced to Shopify`
      );
      refresh();
    } catch {
      toast.error("Failed to sync to Shopify");
    } finally {
      setSyncingOrder(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Label Status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage tracking numbers and label sync
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
              Print Done
            </SelectItem>
            <SelectItem value="LABEL_CREATED">
              {STATUS_LABELS.LABEL_CREATED}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Label Status</TableHead>
              <TableHead>Tracking #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-[280px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  No orders in this status.
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
                    <TableCell>
                      <div className="max-w-[120px] truncate">
                        {order.customerName || "-"}
                      </div>
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(order.shopifyCreatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {!order.trackingNumber && (
                          <>
                            <Input
                              placeholder="Tracking #"
                              className="h-7 w-[140px] text-xs"
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
                              Sync to Shopify
                            </Button>
                          )}
                        {order.labelStatus === "SYNCED_TO_SHOPIFY" && (
                          <span className="text-xs text-green-600 font-medium">
                            Synced
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
          <div className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            {pagination.total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {pagination.page} of {pagination.totalPages}
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
