"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/orders/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Truck, ShoppingBag, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

type RouteChoice = "THIRD_PARTY" | "SHOPIFY";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function useShippingOrders(page: number) {
  const params = new URLSearchParams({
    page: String(page),
    limit: "25",
    shippingRoute: "NOT_ASSIGNED",
    printStatus: "DONE",
    sort: "createdAt",
    dir: "desc",
    view: "all",
  });

  const { data, isLoading, error, mutate } = useSWR<
    PaginatedResponse<OrderListItem>
  >(`/api/orders?${params.toString()}`, fetcher, {
    keepPreviousData: true,
  });

  return {
    orders: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    error,
    refresh: mutate,
  };
}

export default function ShippingPage() {
  const tShipping = useTranslations("shipping");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");

  const [page, setPage] = useState(1);
  const { orders, pagination, isLoading, refresh } = useShippingOrders(page);

  const [routeLoading, setRouteLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    order: OrderListItem | null;
    route: RouteChoice | null;
  }>({ open: false, order: null, route: null });

  const openConfirm = useCallback(
    (order: OrderListItem, route: RouteChoice) => {
      if (order.shippingRoute !== "NOT_ASSIGNED") {
        toast.error("Order is already routed");
        return;
      }
      if (order.internalStatus === "DELAYED") {
        toast.error("Cannot route a delayed order");
        return;
      }
      setConfirmDialog({ open: true, order, route });
    },
    []
  );

  async function handleRoute() {
    const { order, route } = confirmDialog;
    if (!order || !route) return;

    setConfirmDialog((d) => ({ ...d, open: false }));
    setRouteLoading(order.id);

    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shippingRoute: route,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to route order");
      }

      const routeLabel = route === "THIRD_PARTY" ? tShipping("thirdParty") : tShipping("shopify");
      toast.success(
        `Order #${order.shopifyOrderNumber || order.id.slice(0, 8)} → ${routeLabel}`
      );
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to route order"
      );
    } finally {
      setRouteLoading(null);
    }
  }

  const routeLabel =
    confirmDialog.route === "THIRD_PARTY" ? tShipping("thirdParty") : tShipping("shopify");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{tShipping("routing")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tShipping("routingDescription")}
          </p>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tShipping("columns.orderNumber")}</TableHead>
              <TableHead>{tShipping("columns.customer")}</TableHead>
              <TableHead>{tShipping("columns.items")}</TableHead>
              <TableHead>{tShipping("columns.date")}</TableHead>
              <TableHead>{tShipping("columns.status")}</TableHead>
              <TableHead>{tShipping("columns.route")}</TableHead>
              <TableHead>{tShipping("columns.actions")}</TableHead>
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
                  {tShipping("noOrdersAwaiting")}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => {
                const loading = routeLoading === order.id;
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        #{order.shopifyOrderNumber || order.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[150px] truncate">
                        {order.customerName || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.orderItems.length}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(order.shopifyCreatedAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.internalStatus} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.shippingRoute} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => openConfirm(order, "THIRD_PARTY")}
                        >
                          {loading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Truck className="h-3 w-3" />
                          )}
                          {tShipping("thirdParty")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => openConfirm(order, "SHOPIFY")}
                        >
                          {loading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ShoppingBag className="h-3 w-3" />
                          )}
                          {tShipping("shopify")}
                        </Button>
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
            {tCommon("showing")} {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} {tCommon("of")}{" "}
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
              {tCommon("page")} {pagination.page} {tCommon("of")} {pagination.totalPages}
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

      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog((d) => ({ ...d, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tShipping("confirmRouting")}</DialogTitle>
            <DialogDescription>
              {tShipping("routeConfirmMessage", {
                orderNumber: confirmDialog.order?.shopifyOrderNumber || confirmDialog.order?.id.slice(0, 8) || "",
                route: routeLabel,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setConfirmDialog({ open: false, order: null, route: null })
              }
            >
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleRoute}>{tCommon("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
