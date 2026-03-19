"use client";

import { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PriorityStars } from "@/components/cs/priority-stars";
import { CreateCsIssueDialog } from "@/components/cs/create-cs-issue-dialog";
import { CS_ISSUE_TYPES } from "@/lib/constants";
import { Plus, ChevronDown, ChevronUp, Headset } from "lucide-react";
import type { CsCommentWithUser } from "@/types";
import { timeAgo } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type CsSummaryOrder = {
  id: string;
  shopifyOrderNumber: string | null;
  customerName: string | null;
  csPriority: number;
  csIssueType: string | null;
  csNote: string | null;
  internalStatus: string;
  csComments: CsCommentWithUser[];
};

export function CsSummaryPanel({
  onRefreshCounts,
  onRefreshOrders,
}: {
  onRefreshCounts: () => void;
  onRefreshOrders: () => void;
}) {
  const tCS = useTranslations("csQueue");
  const tIssue = useTranslations("csIssueType");

  const { data: orders, mutate } = useSWR<CsSummaryOrder[]>(
    "/api/orders/cs-summary",
    fetcher,
    { refreshInterval: 30000 }
  );

  const [collapsed, setCollapsed] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultOrder, setCreateDefaultOrder] = useState<{
    id: string;
    shopifyOrderNumber: string | null;
    customerName: string | null;
  } | null>(null);

  // Restore collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("cs-summary-collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("cs-summary-collapsed", String(next));
  }

  // Group orders by issue type
  const grouped = useMemo(() => {
    if (!orders) return new Map<string, CsSummaryOrder[]>();
    const map = new Map<string, CsSummaryOrder[]>();
    for (const order of orders) {
      const key = order.csIssueType || "_uncategorized";
      const arr = map.get(key) || [];
      arr.push(order);
      map.set(key, arr);
    }
    return map;
  }, [orders]);

  // Issue type pills with counts
  const pills = useMemo(() => {
    const result: { key: string; label: string; count: number }[] = [];
    // Use CS_ISSUE_TYPES ordering
    for (const type of CS_ISSUE_TYPES) {
      const arr = grouped.get(type);
      if (arr && arr.length > 0) {
        result.push({
          key: type,
          label: tIssue.has(type) ? tIssue(type) : type,
          count: arr.length,
        });
      }
    }
    // Add uncategorized at end
    const uncat = grouped.get("_uncategorized");
    if (uncat && uncat.length > 0) {
      result.push({
        key: "_uncategorized",
        label: tCS("summaryPanel.uncategorized"),
        count: uncat.length,
      });
    }
    return result;
  }, [grouped, tIssue, tCS]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    if (!orders) return [];
    if (!activeFilter) return orders;
    const key = activeFilter;
    return orders.filter(
      (o) => (o.csIssueType || "_uncategorized") === key
    );
  }, [orders, activeFilter]);

  const totalCount = orders?.length || 0;

  if (!orders || totalCount === 0) return null;

  return (
    <>
      <Card className="mb-6 overflow-visible">
        <CardContent className="pt-4 pb-3 px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={toggleCollapsed}
              className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors"
            >
              <Headset className="h-4 w-4" />
              {tCS("summaryPanel.title")}
              <span className="text-muted-foreground font-normal">
                ({totalCount})
              </span>
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setCreateDefaultOrder(null);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {tCS("summaryPanel.createIssue")}
            </Button>
          </div>

          {!collapsed && (
            <>
              {/* Filter pills */}
              {pills.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <button
                    onClick={() => setActiveFilter(null)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      activeFilter === null
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {tCS("summaryPanel.all")} ({totalCount})
                  </button>
                  {pills.map((pill) => (
                    <button
                      key={pill.key}
                      onClick={() =>
                        setActiveFilter(
                          activeFilter === pill.key ? null : pill.key
                        )
                      }
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        activeFilter === pill.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {pill.label} ({pill.count})
                    </button>
                  ))}
                </div>
              )}

              {/* Order cards grid — no overflow so hover popovers aren't clipped */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pb-1">
                {filteredOrders.map((order) => (
                  <CsSummaryCard
                    key={order.id}
                    order={order}
                    onAddIssue={() => {
                      setCreateDefaultOrder({
                        id: order.id,
                        shopifyOrderNumber: order.shopifyOrderNumber,
                        customerName: order.customerName,
                      });
                      setCreateOpen(true);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <CreateCsIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultOrder={createDefaultOrder}
        onSuccess={() => {
          mutate();
          onRefreshCounts();
          onRefreshOrders();
        }}
      />
    </>
  );
}

function CsSummaryCard({ order, onAddIssue }: { order: CsSummaryOrder; onAddIssue: () => void }) {
  const tCS = useTranslations("csQueue");
  const tIssue = useTranslations("csIssueType");
  const tCommon = useTranslations("common");
  const latestComment = order.csComments[0];

  const issueLabel = order.csIssueType
    ? tIssue.has(order.csIssueType)
      ? tIssue(order.csIssueType)
      : order.csIssueType
    : null;

  const commentAuthor =
    latestComment?.user?.displayName ||
    latestComment?.user?.username ||
    null;

  const hasComments = order.csComments.length > 0;

  return (
    <div className="group relative border rounded-lg p-2.5 space-y-1 hover:bg-muted/50 transition-colors">
      {/* Add issue button — top-right, visible on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAddIssue();
        }}
        className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center justify-center h-5 w-5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors z-10"
        title={tCS("summaryPanel.createIssue")}
      >
        <Plus className="h-3 w-3" />
      </button>

      <div className="flex items-center justify-between gap-1">
        <Link
          href={`/orders/${order.id}`}
          className="text-sm font-medium text-primary hover:underline truncate"
        >
          #{order.shopifyOrderNumber || order.id.slice(0, 8)}
        </Link>
        {order.csPriority > 0 && (
          <PriorityStars priority={order.csPriority} />
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground truncate">
          {order.customerName || tCS("unknownCustomer")}
        </span>
        {issueLabel && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            {issueLabel}
          </span>
        )}
      </div>

      {latestComment ? (
        <div className="text-xs text-muted-foreground line-clamp-2">
          {commentAuthor && (
            <span className="font-medium">{commentAuthor}: </span>
          )}
          {latestComment.content.split(/(@\S+)/g).map((part, i) =>
            part.startsWith("@") ? (
              <span key={i} className="font-medium text-primary">{part}</span>
            ) : (part)
          )}
        </div>
      ) : order.csNote ? (
        <div className="text-xs text-muted-foreground line-clamp-2">
          {order.csNote}
        </div>
      ) : null}

      {latestComment && (
        <div className="text-[10px] text-muted-foreground/60">
          {timeAgo(latestComment.createdAt)}
        </div>
      )}

      {/* Hover popover showing all comments */}
      {hasComments && (
        <div className="absolute right-0 bottom-full mb-1 z-50 hidden group-hover:block w-72">
          <div className="rounded-lg border bg-popover p-3 shadow-lg max-h-48 overflow-y-auto space-y-2">
            {order.csComments.map((c) => {
              const author =
                c.user?.displayName || c.user?.username || tCommon("system");
              return (
                <div key={c.id} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{author}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {c.content.split(/(@\S+)/g).map((part, i) =>
                      part.startsWith("@") ? (
                        <span key={i} className="font-medium text-primary">{part}</span>
                      ) : (part)
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
