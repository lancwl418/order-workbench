"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PrioritySelector } from "@/components/cs/priority-stars";
import { CreateCsIssueDialog } from "@/components/cs/create-cs-issue-dialog";
import { MentionInput } from "@/components/cs/mention-input";
import { CS_ISSUE_TYPES } from "@/lib/constants";
import { Plus, ChevronDown, ChevronUp, Headset, ImageIcon, FileText, MessageSquarePlus, Loader2, CheckCircle2 } from "lucide-react";
import type { CsCommentWithUser } from "@/types";
import { timeAgo } from "@/lib/utils";
import { toast } from "sonner";

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

  const { data: session } = useSession();

  const { data: allOrders, mutate: mutateAll } = useSWR<CsSummaryOrder[]>(
    "/api/orders/cs-summary",
    fetcher,
    { refreshInterval: 30000 }
  );

  const { data: taggedOrders, mutate: mutateTagged } = useSWR<CsSummaryOrder[]>(
    session?.user ? "/api/orders/cs-tagged" : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  const [tab, setTab] = useState<"all" | "tagged">("all");
  const orders = tab === "tagged" ? taggedOrders : allOrders;
  const mutate = useCallback(() => { mutateAll(); mutateTagged(); }, [mutateAll, mutateTagged]);

  const [collapsed, setCollapsed] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Resolve handler: unflag CS + revert status
  async function handleResolve(orderId: string) {
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csFlag: false }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Issue resolved");
      mutate();
      onRefreshCounts();
      onRefreshOrders();
    } catch {
      toast.error("Failed to resolve");
    }
  }

  async function handlePriorityChange(orderId: string, csPriority: number) {
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csPriority }),
      });
      if (!res.ok) throw new Error("Failed");
      mutate();
    } catch {
      toast.error("Failed to update priority");
    }
  }

  // Add comment dialog state
  const [commentOrderId, setCommentOrderId] = useState<string | null>(null);
  const [commentOrderLabel, setCommentOrderLabel] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);

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
  const allCount = allOrders?.length || 0;
  const taggedCount = taggedOrders?.length || 0;

  if (!allOrders || (allCount === 0 && taggedCount === 0)) return null;

  return (
    <>
      <Card className="mb-6 overflow-visible">
        {/* Tabs */}
        <div className="flex gap-0 border-b px-4 pt-1">
          <button
            onClick={() => { setTab("all"); setActiveFilter(null); }}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              tab === "all"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            {tCS("summaryPanel.all")} ({allCount})
            {tab === "all" && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => { setTab("tagged"); setActiveFilter(null); }}
            className={`px-3 py-2 text-sm font-medium transition-colors relative ${
              tab === "tagged"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
          >
            Tagged ({taggedCount})
            {tab === "tagged" && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary" />}
          </button>
        </div>

        <CardContent className="pt-4 pb-3 px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={toggleCollapsed}
              className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors"
            >
              <Headset className="h-4 w-4" />
              {tCS("summaryPanel.title")}
              <span className="text-muted-foreground font-normal">({totalCount})</span>
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
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

              {/* Order cards grid — scroll after 3 rows, peek 4th row */}
              {filteredOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {tab === "tagged" ? "No tagged issues for you" : "No CS issues"}
                </p>
              ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 pb-1 max-h-[26rem] overflow-y-auto">
                {filteredOrders.map((order) => (
                  <CsSummaryCard
                    key={order.id}
                    order={order}
                    onAddComment={() => {
                      setCommentOrderId(order.id);
                      setCommentOrderLabel(
                        `#${order.shopifyOrderNumber || order.id.slice(0, 8)}`
                      );
                      setCommentText("");
                      setCommentMentions([]);
                    }}
                    onResolve={() => handleResolve(order.id)}
                    onPriorityChange={(v) => handlePriorityChange(order.id, v)}
                  />
                ))}
              </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <CreateCsIssueDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          mutate();
          onRefreshCounts();
          onRefreshOrders();
        }}
      />

      {/* Add Comment Dialog */}
      <Dialog
        open={!!commentOrderId}
        onOpenChange={(open) => { if (!open) setCommentOrderId(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-4 w-4" />
              Add Comment — {commentOrderLabel}
            </DialogTitle>
          </DialogHeader>
          <MentionInput
            value={commentText}
            onChange={setCommentText}
            mentions={commentMentions}
            onMentionsChange={setCommentMentions}
            placeholder="Type a comment... Use @ to mention"
            rows={3}
            className="text-sm"
            onSubmit={async () => {
              if (!commentText.trim() || !commentOrderId) return;
              setCommentSubmitting(true);
              try {
                const res = await fetch(
                  `/api/orders/${commentOrderId}/cs-comments`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: commentText.trim(),
                      attachments: [],
                      mentions: commentMentions,
                    }),
                  }
                );
                if (!res.ok) throw new Error("Failed");
                toast.success("Comment added");
                setCommentOrderId(null);
                mutate();
                onRefreshCounts();
                onRefreshOrders();
              } catch {
                toast.error("Failed to add comment");
              } finally {
                setCommentSubmitting(false);
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCommentOrderId(null)}
              disabled={commentSubmitting}
            >
              Cancel
            </Button>
            <Button
              disabled={commentSubmitting || !commentText.trim()}
              onClick={async () => {
                if (!commentText.trim() || !commentOrderId) return;
                setCommentSubmitting(true);
                try {
                  const res = await fetch(
                    `/api/orders/${commentOrderId}/cs-comments`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        content: commentText.trim(),
                        attachments: [],
                        mentions: commentMentions,
                      }),
                    }
                  );
                  if (!res.ok) throw new Error("Failed");
                  toast.success("Comment added");
                  setCommentOrderId(null);
                  mutate();
                  onRefreshCounts();
                  onRefreshOrders();
                } catch {
                  toast.error("Failed to add comment");
                } finally {
                  setCommentSubmitting(false);
                }
              }}
            >
              {commentSubmitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving</>
              ) : (
                "Add Comment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CsSummaryCard({ order, onAddComment, onResolve, onPriorityChange }: { order: CsSummaryOrder; onAddComment: () => void; onResolve: () => void; onPriorityChange: (v: number) => void }) {
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

  // Portal-based hover popover to avoid scroll container clipping
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const showPopover = useCallback(() => {
    clearTimeout(hideTimer.current);
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setPopoverStyle({
        position: "fixed",
        top: rect.top - 4,
        right: window.innerWidth - rect.right,
        transform: "translateY(-100%)",
        zIndex: 50,
        width: "18rem",
      });
    }
    setPopoverVisible(true);
  }, []);

  const hidePopover = useCallback(() => {
    hideTimer.current = setTimeout(() => setPopoverVisible(false), 150);
  }, []);

  return (
    <div
      ref={cardRef}
      className="group relative border rounded-lg p-2.5 space-y-1 hover:bg-muted/50 transition-colors"
      onMouseEnter={hasComments ? showPopover : undefined}
      onMouseLeave={hasComments ? hidePopover : undefined}
    >
      {/* Action buttons — bottom-right, visible on hover */}
      <div className="absolute bottom-1 right-1 hidden group-hover:flex items-center gap-1 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onResolve();
          }}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
        >
          <CheckCircle2 className="h-3 w-3" />
          Resolve
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddComment();
          }}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Comment
        </button>
      </div>

      <div className="flex items-center justify-between gap-1">
        <Link
          href={`/orders/${order.id}`}
          className="text-sm font-medium text-primary hover:underline truncate"
        >
          #{order.shopifyOrderNumber || order.id.slice(0, 8)}
        </Link>
        <PrioritySelector value={order.csPriority} onChange={onPriorityChange} />
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

      {/* Hover popover via portal — not clipped by scroll container */}
      {hasComments && popoverVisible && createPortal(
        <div
          style={popoverStyle}
          onMouseEnter={showPopover}
          onMouseLeave={hidePopover}
        >
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
                  {c.attachments?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {c.attachments.map((url, i) => {
                        const filename = url.split("/").pop() || "file";
                        const isImage = /\.(png|jpe?g|webp)$/i.test(filename);
                        return (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-blue-600 hover:underline"
                          >
                            {isImage ? <ImageIcon className="h-2.5 w-2.5 shrink-0" /> : <FileText className="h-2.5 w-2.5 shrink-0" />}
                            <span className="max-w-[100px] truncate">{filename.replace(/^\d{10,}-/, "")}</span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
