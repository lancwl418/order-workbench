"use client";

import { useState, useMemo, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useOrders } from "@/hooks/use-orders";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrintGroups } from "@/hooks/use-print-groups";
import { DataTable } from "@/components/orders/data-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { OrderListItem, PrintGroupWithItems, PrintGroupOrderItem } from "@/types";
import Link from "next/link";
import { Input } from "@/components/ui/input";
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
  Pencil,
  Check,
  Undo2,
  AlertTriangle,
} from "lucide-react";

const MAX_HEIGHT = 360;

export default function PrintQueuePage() {
  const isMobile = useIsMobile();
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");

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

  // Printed today: PRINTED groups whose updatedAt is today (local time)
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const printedTodayGroups = groups.filter(
    (g) => g.status === "PRINTED" && new Date(g.updatedAt).getTime() >= todayStart
  );

  // API already filters to IN_QUEUE only
  const queueOrders = orders;

  const refreshAll = useCallback(() => {
    refreshOrders();
    refreshGroups();
  }, [refreshOrders, refreshGroups]);

  const handleDismiss = useCallback(
    async (orderId: string) => {
      setActionLoading(`dismiss-${orderId}`);
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ printStatus: "READY" }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success("Order removed from queue");
        refreshAll();
      } catch {
        toast.error("Failed to dismiss order");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

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

  const handleReleaseGroup = useCallback(
    async (groupId: string) => {
      setActionLoading(`release-${groupId}`);
      try {
        const res = await fetch(`/api/print-groups/${groupId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed");
        }
        toast.success("Group released - orders back in queue");
        refreshAll();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to release group");
      } finally {
        setActionLoading(null);
      }
    },
    [refreshAll]
  );

  const handleRemoveFromGroup = useCallback(
    async (groupId: string, orderId: string) => {
      setActionLoading(`remove-${orderId}`);
      try {
        const res = await fetch(
          `/api/print-groups/${groupId}/orders/${orderId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed");
        }
        toast.success("Order removed from group");
        refreshAll();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Failed to remove order"
        );
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
        header: tPQ("columns.orderNumber"),
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
        header: tPQ("columns.customer"),
        cell: ({ row }) => (
          <div className="max-w-[150px] truncate">
            {row.getValue("customerName") || "-"}
          </div>
        ),
      },
      {
        id: "items",
        header: tPQ("columns.items"),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.orderItems.length}
          </span>
        ),
      },
      {
        id: "printFiles",
        header: tPQ("columns.printFiles"),
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
              {unique.length} {unique.length > 1 ? tPQ("files") : tPQ("file")}
            </span>
          );
        },
      },
      {
        accessorKey: "shopifyCreatedAt",
        header: tPQ("columns.date"),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.getValue("shopifyCreatedAt"))}
          </span>
        ),
      },
      {
        accessorKey: "internalStatus",
        header: tPQ("columns.status"),
        cell: ({ row }) => (
          <StatusBadge status={row.getValue("internalStatus")} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const id = row.original.id;
          const addLoading = actionLoading === id;
          const dismissLoading = actionLoading === `dismiss-${id}`;

          return (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={addLoading}
                onClick={() => handleAddToGroup(id)}
              >
                {addLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {tPQ("addToGroup")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={dismissLoading}
                onClick={() => handleDismiss(id)}
                title={tPQ("removeFromQueue")}
              >
                {dismissLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </Button>
            </div>
          );
        },
      },
    ],
    [actionLoading, handleAddToGroup, handleDismiss, tPQ]
  );

  const columnVisibility = useMemo(
    () =>
      isMobile
        ? {
            customerName: false,
            shopifyCreatedAt: false,
            printFiles: false,
          }
        : undefined,
    [isMobile]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tPQ("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tPQ("description")}
        </p>
      </div>

      {/* Section A: Group Builder */}
      {buildingGroup && (
        <GroupBuilderCard
          group={buildingGroup}
          onCombine={handleCombine}
          onRemoveOrder={handleRemoveOrder}
          onFileReplaced={refreshAll}
          actionLoading={actionLoading}
        />
      )}

      {/* Section B: Ready to Print orders */}
      <div>
        <h2 className="text-lg font-medium mb-3">{tPQ("inQueue")}</h2>
        <DataTable
          columns={columns}
          data={queueOrders}
          pagination={pagination}
          onPageChange={setPage}
          isLoading={isLoading}
          columnVisibility={columnVisibility}
        />
      </div>

      {/* Section C: Print Groups */}
      {readyGroups.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3">{tPQ("printGroups")}</h2>
          <div className="space-y-3">
            {readyGroups.map((group) => (
              <PrintGroupCard
                key={group.id}
                group={group}
                onMarkPrinted={handleMarkPrinted}
                onReleaseGroup={handleReleaseGroup}
                onRemoveOrder={handleRemoveFromGroup}
                actionLoading={actionLoading}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section D: Printed Today */}
      {printedTodayGroups.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-3 text-muted-foreground">
            {tPQ("printedToday")}
          </h2>
          <div className="space-y-3 opacity-60">
            {printedTodayGroups.map((group) => (
              <PrintedGroupCard key={group.id} group={group} />
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
  onFileReplaced,
  actionLoading,
}: {
  group: PrintGroupWithItems;
  onCombine: (groupId: string) => void;
  onRemoveOrder: (groupId: string, orderId: string) => void;
  onFileReplaced: () => void;
  actionLoading: string | null;
}) {
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");

  const pct = Math.min((group.totalHeight / MAX_HEIGHT) * 100, 100);
  const isWarning = pct > 80;

  // Group items by order
  const orderMap = new Map<
    string,
    {
      orderNumber: string | null;
      customerName: string | null;
      files: typeof group.items;
      orderItems: PrintGroupOrderItem[];
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
        orderItems: item.order.orderItems || [],
      });
    }
  }

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5" />
            {group.name}
            <Badge variant="outline" className="ml-2">
              {tPQ("building")}
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
            {tPQ("combineGroup")}
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
              {orderMap.size} {orderMap.size !== 1 ? tPQ("orders_count") : tPQ("order")}
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
            {tPQ("noOrdersYet")}
          </p>
        )}
        <div className="space-y-2">
          {[...orderMap.entries()].map(([orderId, data]) => (
            <GroupBuilderOrderEntry
              key={orderId}
              orderId={orderId}
              data={data}
              groupId={group.id}
              onRemoveOrder={onRemoveOrder}
              onFileReplaced={onFileReplaced}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GroupBuilderOrderEntry({
  orderId,
  data,
  groupId,
  onRemoveOrder,
  onFileReplaced,
  actionLoading,
}: {
  orderId: string;
  data: {
    orderNumber: string | null;
    customerName: string | null;
    files: PrintGroupWithItems["items"];
    orderItems: PrintGroupOrderItem[];
  };
  groupId: string;
  onRemoveOrder: (groupId: string, orderId: string) => void;
  onFileReplaced: () => void;
  actionLoading: string | null;
}) {
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");

  const [editing, setEditing] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);

  const printItems = data.orderItems.filter((oi) => oi.designFileUrl);
  const orderHeight = data.files.reduce((sum, f) => sum + f.heightInches, 0);

  function startEditing() {
    const initial: Record<string, string> = {};
    for (const oi of printItems) {
      initial[oi.id] = oi.designFileUrl || "";
    }
    setUrls(initial);
    setEditing(true);
  }

  async function handleSave() {
    // Find changed items
    const changed = printItems.filter(
      (oi) => urls[oi.id] && urls[oi.id] !== oi.designFileUrl
    );
    if (changed.length === 0) {
      setEditing(false);
      return;
    }

    setReplacing(true);
    try {
      for (const oi of changed) {
        const res = await fetch(`/api/order-items/${oi.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ designFileUrl: urls[oi.id] }),
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed");
        }
      }
      toast.success("Print files replaced");
      setEditing(false);
      onFileReplaced();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to replace files");
    } finally {
      setReplacing(false);
    }
  }

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center justify-between p-3">
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
            {data.files.length} {data.files.length > 1 ? tPQ("files") : tPQ("file")} &middot;{" "}
            {orderHeight.toFixed(1)}&quot;
          </span>
        </div>
        <div className="flex items-center gap-1">
          {printItems.length > 0 && !editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={startEditing}
              title={tPQ("replacePrintFiles")}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemoveOrder(groupId, orderId)}
            disabled={actionLoading === `remove-${orderId}`}
          >
            {actionLoading === `remove-${orderId}` ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
      {editing && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {printItems.map((oi) => (
            <div key={oi.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  {oi.title}
                  {oi.variantTitle ? ` - ${oi.variantTitle}` : ""}
                </p>
                {oi.originalDesignFileUrl && oi.originalDesignFileUrl !== urls[oi.id] && (
                  <button
                    onClick={() =>
                      setUrls((prev) => ({
                        ...prev,
                        [oi.id]: oi.originalDesignFileUrl!,
                      }))
                    }
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                    title="Revert to original"
                  >
                    <Undo2 className="h-2.5 w-2.5" />
                    Original
                  </button>
                )}
              </div>
              <Input
                value={urls[oi.id] || ""}
                onChange={(e) =>
                  setUrls((prev) => ({ ...prev, [oi.id]: e.target.value }))
                }
                placeholder="Paste new file URL..."
                className="text-xs h-7"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="xs"
              onClick={handleSave}
              disabled={replacing}
            >
              {replacing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {tCommon("save")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={replacing}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Print Group Card (READY / PRINTED) ────────────────────────── */

function PrintGroupCard({
  group,
  onMarkPrinted,
  onReleaseGroup,
  onRemoveOrder,
  actionLoading,
}: {
  group: PrintGroupWithItems;
  onMarkPrinted: (groupId: string) => void;
  onReleaseGroup: (groupId: string) => void;
  onRemoveOrder: (groupId: string, orderId: string) => void;
  actionLoading: string | null;
}) {
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");

  const [expanded, setExpanded] = useState(true);
  const [confirmPrintOpen, setConfirmPrintOpen] = useState(false);

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
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
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
              variant="default"
              className="bg-green-100 text-green-700"
            >
              {tPQ("ready")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {orderMap.size} {orderMap.size !== 1 ? tPQ("orders_count") : tPQ("order")} &middot;{" "}
              {group.items.length} {group.items.length !== 1 ? tPQ("files") : tPQ("file")} &middot;{" "}
              {group.totalHeight.toFixed(1)}&quot;
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isReady && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onReleaseGroup(group.id)}
                  disabled={actionLoading === `release-${group.id}`}
                  title={tPQ("release")}
                >
                  {actionLoading === `release-${group.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Undo2 className="h-3 w-3" />
                  )}
                  {tPQ("release")}
                </Button>
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
                  {downloading ? tPQ("combining") : tPQ("downloadCombined")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => setConfirmPrintOpen(true)}
                  disabled={actionLoading === `printed-${group.id}`}
                >
                  {actionLoading === `printed-${group.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  {tPQ("markPrinted")}
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
                    {isReady && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => onRemoveOrder(group.id, orderId)}
                        disabled={actionLoading === `remove-${orderId}`}
                        title={tPQ("removeFromGroup")}
                      >
                        {actionLoading === `remove-${orderId}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </Button>
                    )}
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

      {/* Mark Printed confirmation dialog */}
      <Dialog open={confirmPrintOpen} onOpenChange={setConfirmPrintOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {tPQ("confirmPrintTitle")}
            </DialogTitle>
            <DialogDescription>
              {tPQ("confirmPrintMessage", {
                groupName: group.name,
                orderCount: orderMap.size,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>
              {tCommon("cancel")}
            </DialogClose>
            <Button
              size="sm"
              onClick={() => {
                setConfirmPrintOpen(false);
                onMarkPrinted(group.id);
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tPQ("confirmPrinted")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ─── Printed Group Card (read-only, greyed out) ───────────────── */

function PrintedGroupCard({ group }: { group: PrintGroupWithItems }) {
  const tPQ = useTranslations("printQueue");

  const [expanded, setExpanded] = useState(false);

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
    <Card>
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
            <Badge variant="secondary">{tPQ("printed")}</Badge>
            <span className="text-sm text-muted-foreground">
              {orderMap.size} {orderMap.size !== 1 ? tPQ("orders_count") : tPQ("order")} &middot;{" "}
              {group.items.length} {group.items.length !== 1 ? tPQ("files") : tPQ("file")} &middot;{" "}
              {group.totalHeight.toFixed(1)}&quot;
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(group.updatedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </div>

        {expanded && (
          <div className="mt-3 pl-7 space-y-3">
            {[...orderMap.entries()].map(([orderId, data]) => {
              const orderHeight = data.files.reduce(
                (sum, f) => sum + f.heightInches, 0
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
