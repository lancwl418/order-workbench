"use client";

import { useState, useMemo, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useOrders } from "@/hooks/use-orders";
import { usePrintGroups } from "@/hooks/use-print-groups";
import { DataTable } from "@/components/orders/data-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { OrderListItem, PrintGroupWithItems } from "@/types";
import Link from "next/link";
import {
  Plus,
  Layers,
  CheckCircle2,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Ruler,
  Download,
  ExternalLink,
} from "lucide-react";

const MAX_HEIGHT = 360;

export default function PrintQueuePage() {
  const {
    orders,
    pagination,
    isLoading,
    setPage,
    refresh: refreshOrders,
  } = useOrders("print-queue");

  const { groups, refresh: refreshGroups } = usePrintGroups();

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const buildingGroup = groups.find((g) => g.status === "BUILDING");
  const readyGroups = groups.filter((g) => g.status === "READY");
  const printedGroups = groups.filter((g) => g.status === "PRINTED");

  // API already filters to READY_TO_PRINT only
  const readyToPrintOrders = orders;

  const refreshAll = useCallback(() => {
    refreshOrders();
    refreshGroups();
  }, [refreshOrders, refreshGroups]);

  const handleAddToGroup = useCallback(
    async (orderId: string) => {
      setActionLoading(orderId);
      try {
        const res = await fetch("/api/print-groups/add-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed");
        }
        toast.success("Added to print group");
        refreshAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add to group");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

  const handleCombine = useCallback(
    async (groupId: string) => {
      setActionLoading(`combine-${groupId}`);
      try {
        const res = await fetch(`/api/print-groups/${groupId}/combine`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("Failed");
        toast.success("Group combined - ready to print");
        refreshAll();
      } catch {
        toast.error("Failed to combine group");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

  const handleRemoveOrder = useCallback(
    async (groupId: string, orderId: string) => {
      setActionLoading(`remove-${orderId}`);
      try {
        const res = await fetch(
          `/api/print-groups/${groupId}/orders/${orderId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("Failed");
        toast.success("Order removed from group");
        refreshAll();
      } catch {
        toast.error("Failed to remove order");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

  const handleMarkPrinted = useCallback(
    async (groupId: string) => {
      setActionLoading(`printed-${groupId}`);
      try {
        const res = await fetch(`/api/print-groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "PRINTED" }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success("Group marked as printed");
        refreshAll();
      } catch {
        toast.error("Failed to mark as printed");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

  const columns: ColumnDef<OrderListItem>[] = useMemo(
    () => [
      {
        accessorKey: "shopifyOrderNumber",
        header: "Order #",
        cell: ({ row }) => (
          <Link
            href={`/orders/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            #{row.getValue("shopifyOrderNumber") || row.original.id.slice(0, 8)}
          </Link>
        ),
      },
      {
        accessorKey: "customerName",
        header: "Customer",
        cell: ({ row }) => (
          <div className="max-w-[150px] truncate">
            {row.getValue("customerName") || "-"}
          </div>
        ),
      },
      {
        id: "items",
        header: "Items",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.orderItems.length}
          </span>
        ),
      },
      {
        id: "printFiles",
        header: "Print Files",
        cell: ({ row }) => {
          const urls = row.original.orderItems
            .filter((item) => item.designFileUrl)
            .map((item) => ({
              url: item.designFileUrl!,
              title: item.variantTitle || item.title,
            }));
          const unique = urls.filter(
            (u, i, arr) => arr.findIndex((a) => a.url === u.url) === i
          );
          if (unique.length === 0)
            return (
              <span className="text-xs text-muted-foreground">-</span>
            );
          return (
            <span className="text-sm text-muted-foreground">
              {unique.length} file{unique.length > 1 ? "s" : ""}
            </span>
          );
        },
      },
      {
        accessorKey: "shopifyCreatedAt",
        header: "Date",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.getValue("shopifyCreatedAt"))}
          </span>
        ),
      },
      {
        accessorKey: "internalStatus",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge status={row.getValue("internalStatus")} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const id = row.original.id;
          const loading = actionLoading === id;

          return (
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => handleAddToGroup(id)}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Add to Group
            </Button>
          );
        },
      },
    ],
    [actionLoading, handleAddToGroup]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Print Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Combine orders into print groups for efficient batch printing
        </p>
      </div>

      {/* Section A: Group Builder */}
      {buildingGroup && (
        <GroupBuilderCard
          group={buildingGroup}
          onCombine={handleCombine}
          onRemoveOrder={handleRemoveOrder}
          actionLoading={actionLoading}
        />
      )}

      {/* Section B: Ready to Print orders */}
      <div>
        <h2 className="text-lg font-medium mb-3">Ready to Print</h2>
        <DataTable
          columns={columns}
          data={readyToPrintOrders}
          pagination={pagination}
          onPageChange={setPage}
          isLoading={isLoading}
        />
      </div>

      {/* Section C: Print Groups */}
      {(readyGroups.length > 0 || printedGroups.length > 0) && (
        <div>
          <h2 className="text-lg font-medium mb-3">Print Groups</h2>
          <div className="space-y-3">
            {readyGroups.map((group) => (
              <PrintGroupCard
                key={group.id}
                group={group}
                onMarkPrinted={handleMarkPrinted}
                actionLoading={actionLoading}
              />
            ))}
            {printedGroups.map((group) => (
              <PrintGroupCard
                key={group.id}
                group={group}
                onMarkPrinted={handleMarkPrinted}
                actionLoading={actionLoading}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Group Builder Card ────────────────────────────────────────── */

function GroupBuilderCard({
  group,
  onCombine,
  onRemoveOrder,
  actionLoading,
}: {
  group: PrintGroupWithItems;
  onCombine: (groupId: string) => void;
  onRemoveOrder: (groupId: string, orderId: string) => void;
  actionLoading: string | null;
}) {
  const pct = Math.min((group.totalHeight / MAX_HEIGHT) * 100, 100);
  const isWarning = pct > 80;

  // Group items by order
  const orderMap = new Map<
    string,
    { orderNumber: string | null; customerName: string | null; files: typeof group.items }
  >();
  for (const item of group.items) {
    const existing = orderMap.get(item.orderId);
    if (existing) {
      existing.files.push(item);
    } else {
      orderMap.set(item.orderId, {
        orderNumber: item.order.shopifyOrderNumber,
        customerName: item.order.customerName,
        files: [item],
      });
    }
  }

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5" />
            {group.name}
            <Badge variant="outline" className="ml-2">
              Building
            </Badge>
          </CardTitle>
          <Button
            onClick={() => onCombine(group.id)}
            disabled={
              actionLoading === `combine-${group.id}` ||
              group.items.length === 0
            }
          >
            {actionLoading === `combine-${group.id}` ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
            Combine Group
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Capacity bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Ruler className="h-3 w-3" />
              {group.totalHeight.toFixed(1)}&quot; / {MAX_HEIGHT}&quot;
            </span>
            <span className="text-muted-foreground">
              {orderMap.size} order{orderMap.size !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isWarning ? "bg-orange-500" : "bg-primary"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Orders in group */}
        {orderMap.size === 0 && (
          <p className="text-sm text-muted-foreground">
            No orders yet. Click &quot;Add to Group&quot; on orders below.
          </p>
        )}
        <div className="space-y-2">
          {[...orderMap.entries()].map(([orderId, data]) => {
            const orderHeight = data.files.reduce(
              (sum, f) => sum + f.heightInches,
              0
            );
            return (
              <div
                key={orderId}
                className="flex items-center justify-between p-3 rounded-md border bg-background"
              >
                <div className="flex items-center gap-3">
                  <Link
                    href={`/orders/${orderId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    #{data.orderNumber || orderId.slice(0, 8)}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {data.customerName || "-"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data.files.length} file{data.files.length > 1 ? "s" : ""} &middot;{" "}
                    {orderHeight.toFixed(1)}&quot;
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemoveOrder(group.id, orderId)}
                  disabled={actionLoading === `remove-${orderId}`}
                >
                  {actionLoading === `remove-${orderId}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Print Group Card (READY / PRINTED) ────────────────────────── */

function PrintGroupCard({
  group,
  onMarkPrinted,
  actionLoading,
}: {
  group: PrintGroupWithItems;
  onMarkPrinted: (groupId: string) => void;
  actionLoading: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Group items by order for summary
  const orderMap = new Map<
    string,
    {
      orderNumber: string | null;
      customerName: string | null;
      files: typeof group.items;
    }
  >();
  for (const item of group.items) {
    const existing = orderMap.get(item.orderId);
    if (existing) {
      existing.files.push(item);
    } else {
      orderMap.set(item.orderId, {
        orderNumber: item.order.shopifyOrderNumber,
        customerName: item.order.customerName,
        files: [item],
      });
    }
  }

  const isReady = group.status === "READY";
  const isPrinted = group.status === "PRINTED";

  const [downloading, setDownloading] = useState(false);

  async function handleDownloadAll() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/print-groups/${group.id}/download`);
      if (!res.ok) throw new Error("Failed to generate combined image");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${group.name.replace(/[^a-zA-Z0-9#]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download combined image");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className={isPrinted ? "opacity-60" : ""}>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <span className="font-medium">{group.name}</span>
            <Badge
              variant={isReady ? "default" : "secondary"}
              className={isReady ? "bg-green-100 text-green-700" : ""}
            >
              {isReady ? "Ready" : "Printed"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {orderMap.size} order{orderMap.size !== 1 ? "s" : ""} &middot;{" "}
              {group.items.length} file{group.items.length !== 1 ? "s" : ""} &middot;{" "}
              {group.totalHeight.toFixed(1)}&quot;
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isReady && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadAll}
                  disabled={downloading}
                >
                  {downloading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {downloading ? "Combining..." : "Download Combined"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onMarkPrinted(group.id)}
                  disabled={actionLoading === `printed-${group.id}`}
                >
                  {actionLoading === `printed-${group.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Mark Printed
                </Button>
              </>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pl-7 space-y-3">
            {[...orderMap.entries()].map(([orderId, data]) => {
              const orderHeight = data.files.reduce(
                (sum, f) => sum + f.heightInches,
                0
              );
              return (
                <div key={orderId} className="space-y-1">
                  <div className="flex items-center gap-3 text-sm">
                    <Link
                      href={`/orders/${orderId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      #{data.orderNumber || orderId.slice(0, 8)}
                    </Link>
                    <span className="text-muted-foreground">
                      {data.customerName || "-"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {orderHeight.toFixed(1)}&quot;
                    </span>
                  </div>
                  {/* Individual files */}
                  <div className="pl-4 space-y-0.5">
                    {data.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <a
                          href={file.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline truncate max-w-[300px] flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {file.filename}
                        </a>
                        <span className="text-muted-foreground shrink-0">
                          {file.widthPx}&times;{file.heightPx}px &middot;{" "}
                          {file.heightInches.toFixed(1)}&quot;
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
