"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  Link2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

const MAX_HEIGHT = 3897;

/* ─── Print File Cell (for In Queue table) ────────────────────── */

function PrintFileCellActions({
  order,
  onUpdated,
}: {
  order: OrderListItem;
  onUpdated: () => void;
}) {
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");

  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ url: string; itemIds: string[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group items by unique designFileUrl
  const fileGroups = useMemo(() => {
    const map = new Map<string, { url: string; title: string; itemIds: string[] }>();
    for (const item of order.orderItems) {
      if (!item.designFileUrl) continue;
      const existing = map.get(item.designFileUrl);
      if (existing) {
        existing.itemIds.push(item.id);
      } else {
        map.set(item.designFileUrl, {
          url: item.designFileUrl,
          title: item.variantTitle || item.title,
          itemIds: [item.id],
        });
      }
    }
    return [...map.values()];
  }, [order.orderItems]);

  if (fileGroups.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  async function handleReplace(sourceUrl: string, replaceUrl: string) {
    setReplacing(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/replace-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl, newUrl: replaceUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      toast.success(tPQ("fileReplaced"));
      setEditingUrl(null);
      setNewUrl("");
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setReplacing(false);
    }
  }

  async function handleUpload(sourceUrl: string, file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();
      await handleReplace(sourceUrl, url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      for (const itemId of deleteTarget.itemIds) {
        const res = await fetch(`/api/order-items/${itemId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed");
        }
      }
      toast.success(tPQ("fileDeleted"));
      setDeleteTarget(null);
      onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  // Extract short filename from URL
  function shortName(url: string) {
    try {
      const parts = url.split("/");
      const name = decodeURIComponent(parts[parts.length - 1]);
      return name.length > 30 ? name.slice(0, 27) + "..." : name;
    } catch {
      return "file";
    }
  }

  return (
    <div className="space-y-1">
      {fileGroups.map((fg) => (
        <div key={fg.url} className="space-y-1">
          <div className="flex items-center gap-1">
            <a
              href={fg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline truncate max-w-[140px]"
              title={fg.url}
            >
              {shortName(fg.url)}
            </a>
            <button
              onClick={() => {
                setEditingUrl(editingUrl === fg.url ? null : fg.url);
                setNewUrl("");
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={tPQ("replaceFile")}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => setDeleteTarget(fg)}
              className="text-muted-foreground hover:text-destructive shrink-0"
              title={tPQ("deleteFile")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {editingUrl === fg.url && (
            <div className="space-y-1 pl-1">
              <div className="flex items-center gap-1">
                <Input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder={tPQ("pasteNewUrl")}
                  className="text-xs h-6 w-40"
                  autoFocus
                />
                <Button
                  size="xs"
                  onClick={() => handleReplace(fg.url, newUrl.trim())}
                  disabled={replacing || uploading || !newUrl.trim()}
                >
                  {replacing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setEditingUrl(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(fg.url, f);
                    e.target.value = "";
                  }}
                />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={replacing || uploading}
                >
                  {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {tPQ("uploadFile")}
                </Button>
                <span className="text-[10px] text-muted-foreground">{tPQ("orPasteUrl")}</span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tPQ("confirmDeleteFile")}</DialogTitle>
            <DialogDescription>{tPQ("confirmDeleteFileDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {tCommon("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
        cell: ({ row }) => (
          <PrintFileCellActions order={row.original} onUpdated={refreshAll} />
        ),
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
    [actionLoading, handleAddToGroup, handleDismiss, refreshAll, tPQ]
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{tPQ("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tPQ("description")}
          </p>
        </div>
        <Link href="/print-queue/history">
          <Button variant="outline" size="sm">
            {tPQ("history")}
          </Button>
        </Link>
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

/* ─── Inline Group Name Editor ──────────────────────────────────── */

function GroupNameEditor({ group }: { group: PrintGroupWithItems }) {
  const tPQ = useTranslations("printQueue");
  const { refresh } = usePrintGroups();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || name === group.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/print-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      toast.success(tPQ("groupRenamed"));
      setEditing(false);
      refresh();
    } catch {
      toast.error("Failed to rename");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-6 w-[140px] text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") { setEditing(false); setName(group.name); }
          }}
          autoFocus
        />
        <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-700">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button onClick={() => { setEditing(false); setName(group.name); }} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button className="font-medium hover:underline flex items-center gap-1" onClick={() => { setName(group.name); setEditing(true); }}>
      {group.name}
      <Pencil className="h-3 w-3 text-muted-foreground" />
    </button>
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
            <GroupNameEditor group={group} />
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
  const { refresh } = usePrintGroups();

  const [expanded, setExpanded] = useState(true);
  const [confirmPrintOpen, setConfirmPrintOpen] = useState(false);

  // In-memory phase detail for smoother progress while on page
  const [phaseDetail, setPhaseDetail] = useState<{
    phase: string;
    totalImages?: number;
    currentImage?: number;
    totalChunks?: number;
    currentChunk?: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isProcessing = group.downloadStatus === "PROCESSING";
  const isFailed = group.downloadStatus === "FAILED";

  // Poll in-memory progress for smoother phase detail while processing
  useEffect(() => {
    if (isProcessing) {
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/print-groups/${group.id}/download-progress`);
          if (r.ok) {
            const data = await r.json();
            if (data.progress >= 0) {
              setPhaseDetail({
                phase: data.phase,
                totalImages: data.totalImages,
                currentImage: data.currentImage,
                totalChunks: data.totalChunks,
                currentChunk: data.currentChunk,
              });
            }
          }
        } catch { /* ignore */ }
      }, 2000);
    } else {
      setPhaseDetail(null);
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [isProcessing, group.id]);

  // ETA calculation
  const etaText = useMemo(() => {
    if (!isProcessing || !group.downloadStartedAt || group.downloadProgress <= 0) return null;
    const elapsed = (Date.now() - new Date(group.downloadStartedAt).getTime()) / 1000;
    const rate = group.downloadProgress / elapsed;
    if (rate <= 0) return null;
    const remainingSec = Math.round((100 - group.downloadProgress) / rate);
    if (remainingSec >= 60) {
      return tPQ("estimatedTime", { time: tPQ("minuteShort", { count: Math.ceil(remainingSec / 60) }) });
    }
    return tPQ("estimatedTime", { time: tPQ("secondShort", { count: remainingSec }) });
  }, [isProcessing, group.downloadStartedAt, group.downloadProgress, tPQ]);

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

  async function handleCombineStart() {
    // If we already have a cached URL, open it directly
    if (group.combinedFileUrl) {
      window.open(group.combinedFileUrl, "_blank");
      return;
    }

    try {
      const res = await fetch(`/api/print-groups/${group.id}/download`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) return; // already in progress
        throw new Error(data.error || "Failed to start combine");
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start combine");
    }
  }

  async function handleRetry() {
    // Clear the failed status first
    await fetch(`/api/print-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: group.name }),
    });
    refresh();
    // Then trigger a new combine after a short delay
    setTimeout(handleCombineStart, 500);
  }

  async function handleCancelCombine() {
    try {
      await fetch(`/api/print-groups/${group.id}/cancel-combine`, {
        method: "POST",
      });
      refresh();
    } catch {
      toast.error("Failed to cancel");
    }
  }

  async function handleRecombine() {
    try {
      // Clear cached URL first
      await fetch(`/api/print-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: group.name }),
      });
      // Directly trigger new combine (skip handleCombineStart which checks stale props)
      const res = await fetch(`/api/print-groups/${group.id}/download`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status !== 409) {
          throw new Error(data.error || "Failed to start combine");
        }
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start re-combine");
    }
  }

  // Phase text from in-memory detail or fallback to generic
  const phase = phaseDetail?.phase || (isProcessing ? "downloading" : null);

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
            <GroupNameEditor group={group} />
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
                  disabled={actionLoading === `release-${group.id}` || isProcessing}
                  title={tPQ("release")}
                >
                  {actionLoading === `release-${group.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Undo2 className="h-3 w-3" />
                  )}
                  {tPQ("release")}
                </Button>
                {isProcessing ? (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {tPQ("combining")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={handleCancelCombine}
                      title={tPQ("cancelCombine")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCombineStart}
                  >
                    <Download className="h-3 w-3" />
                    {tPQ("downloadCombined")}
                  </Button>
                )}
                {group.combinedFileUrl && !isProcessing && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(group.combinedFileUrl!, "_blank")}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(group.combinedFileUrl!);
                        toast.success(tPQ("linkCopied"));
                      }}
                    >
                      <Link2 className="h-3 w-3" />
                      {tPQ("copyLink")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRecombine}
                      title={tPQ("recombine")}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {tPQ("recombine")}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  onClick={() => setConfirmPrintOpen(true)}
                  disabled={actionLoading === `printed-${group.id}` || isProcessing}
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

        {/* Background progress bar */}
        {isProcessing && (
          <div className="mt-3 space-y-1">
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${group.downloadProgress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {phase === "downloading" &&
                tPQ("progressDownloading", {
                  current: phaseDetail?.currentImage ?? 0,
                  total: phaseDetail?.totalImages ?? group.items.length,
                })}
              {phase === "generating" &&
                tPQ("progressGenerating", {
                  current: phaseDetail?.currentChunk ?? 0,
                  total: phaseDetail?.totalChunks ?? 0,
                })}
              {phase === "zipping" && tPQ("progressZipping")}
              {phase === "uploading" && tPQ("progressUploading")}
              {" — "}{group.downloadProgress}%
              {etaText && <>{" — "}{etaText}</>}
            </p>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4" />
            <span>{tPQ("combineFailed")}{group.downloadError ? `: ${group.downloadError}` : ""}</span>
            <Button size="xs" variant="outline" onClick={handleRetry}>
              {tPQ("retry")}
            </Button>
          </div>
        )}

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
            <GroupNameEditor group={group} />
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
