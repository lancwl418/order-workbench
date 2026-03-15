"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useOrders } from "@/hooks/use-orders";
import { DataTable } from "@/components/orders/data-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { formatDate, timeAgo } from "@/lib/utils";
import { CS_ISSUE_TYPES } from "@/lib/constants";
import type { OrderListItem } from "@/types";
import type { CsCommentWithUser } from "@/types";
import Link from "next/link";
import {
  Star,
  Flag,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  FileText,
  Image as ImageIcon,
  X,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function PriorityStars({ priority }: { priority: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < priority
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

export default function CSQueuePage() {
  const tCS = useTranslations("csQueue");
  const tIssue = useTranslations("csIssueType");
  const tCommon = useTranslations("common");

  const {
    orders,
    pagination,
    isLoading,
    setPage,
    setSort,
    refresh,
  } = useOrders("cs-queue");

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [sheetOrder, setSheetOrder] = useState<OrderListItem | null>(null);

  const handleResolve = useCallback(
    async (orderId: string) => {
      setResolvingId(orderId);
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csFlag: false }),
        });
        if (!res.ok) throw new Error("Failed to resolve");
        toast.success("CS flag removed");
        refresh();
      } catch {
        toast.error("Failed to resolve CS issue");
      } finally {
        setResolvingId(null);
      }
    },
    [refresh]
  );

  const handleIssueTypeChange = useCallback(
    async (orderId: string, csIssueType: string) => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csIssueType }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success("Issue type updated");
        refresh();
      } catch {
        toast.error("Failed to update issue type");
      }
    },
    [refresh]
  );

  const columns: ColumnDef<OrderListItem>[] = useMemo(
    () => [
      {
        accessorKey: "csPriority",
        header: tCS("columns.priority"),
        cell: ({ row }) => (
          <PriorityStars priority={row.original.csPriority || 0} />
        ),
      },
      {
        accessorKey: "shopifyOrderNumber",
        header: tCS("columns.orderNumber"),
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
        header: tCS("columns.customer"),
        cell: ({ row }) => (
          <div className="max-w-[150px] truncate">
            {row.getValue("customerName") || "-"}
          </div>
        ),
      },
      {
        accessorKey: "internalStatus",
        header: tCS("columns.status"),
        cell: ({ row }) => (
          <StatusBadge status={row.getValue("internalStatus")} />
        ),
      },
      {
        accessorKey: "csIssueType",
        header: tCS("columns.issueType"),
        cell: ({ row }) => {
          const id = row.original.id;
          const current = row.original.csIssueType;

          return (
            <Select
              value={current || ""}
              onValueChange={(v) => v && handleIssueTypeChange(id, v)}
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                {current ? (
                  <span>{tIssue.has(current) ? tIssue(current) : current}</span>
                ) : (
                  <span className="text-muted-foreground">{tCS("select")}</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {CS_ISSUE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {tIssue.has(t) ? tIssue(t) : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
      {
        id: "csComments",
        header: tCS("columns.csNotes"),
        cell: ({ row }) => {
          const order = row.original;
          const note = order.csNote;
          return (
            <button
              onClick={() => setSheetOrder(order)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {note ? (
                <span className="max-w-[150px] truncate">{note}</span>
              ) : (
                <span className="text-xs">{tCS("addNote")}</span>
              )}
            </button>
          );
        },
      },
      {
        accessorKey: "shopifyCreatedAt",
        header: tCS("columns.date"),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.getValue("shopifyCreatedAt"))}
          </span>
        ),
      },
      {
        id: "actions",
        header: tCS("columns.actions"),
        cell: ({ row }) => {
          const id = row.original.id;
          const loading = resolvingId === id;

          return (
            <div className="flex items-center gap-2">
              <Link href={`/orders/${id}`}>
                <Button size="sm" variant="outline">
                  {tCS("view")}
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => handleResolve(id)}
                title="Remove CS flag"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Flag className="h-3 w-3" />
                )}
                {tCS("resolve")}
              </Button>
            </div>
          );
        },
      },
    ],
    [resolvingId, handleResolve, handleIssueTypeChange, tCS, tIssue]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{tCS("fullTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tCS("flaggedDescription")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSort("csPriority", "desc")}
        >
          {tCS("sortByPriority")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={orders}
        pagination={pagination}
        onPageChange={setPage}
        isLoading={isLoading}
      />

      {/* CS Comment Sheet */}
      <Sheet
        open={!!sheetOrder}
        onOpenChange={(open) => {
          if (!open) setSheetOrder(null);
        }}
      >
        <SheetContent side="right" className="sm:max-w-md w-full flex flex-col">
          {sheetOrder && (
            <CommentSheet
              orderId={sheetOrder.id}
              orderNumber={sheetOrder.shopifyOrderNumber}
              customerName={sheetOrder.customerName}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ─── Comment Sheet ─────────────────────────────────────────────── */

function CommentSheet({
  orderId,
  orderNumber,
  customerName,
}: {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
}) {
  const tCS = useTranslations("csQueue");
  const tCommon = useTranslations("common");
  const tOD = useTranslations("orderDetail");

  const {
    data: comments,
    mutate,
  } = useSWR<CsCommentWithUser[]>(
    `/api/orders/${orderId}/cs-comments`,
    fetcher
  );

  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<
    { url: string; filename: string }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload/cs", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        const data = await res.json();
        setAttachments((prev) => [
          ...prev,
          { url: data.url, filename: data.filename },
        ]);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload file"
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() && attachments.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/cs-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          attachments: attachments.map((a) => a.url),
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setContent("");
      setAttachments([]);
      mutate();
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {tCS("csNotes")} — #{orderNumber || orderId.slice(0, 8)}
        </SheetTitle>
        <SheetDescription>{customerName || tCS("unknownCustomer")}</SheetDescription>
      </SheetHeader>

      {/* New comment form */}
      <div className="px-4 space-y-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tCS("addCommentPlaceholder")}
          rows={3}
          className="text-sm"
        />

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
              >
                <AttachmentIcon filename={att.filename} />
                <span className="max-w-[120px] truncate">{att.filename}</span>
                <button
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="text-muted-foreground hover:text-foreground ml-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            multiple
            onChange={handleFileUpload}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Paperclip className="h-3 w-3" />
            )}
            {uploading ? tCommon("uploading") : tOD("attach")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || (!content.trim() && attachments.length === 0)}
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {tOD("send")}
          </Button>
        </div>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {!comments ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {tCS("noComments")}
          </p>
        ) : (
          comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} />
          ))
        )}
      </div>
    </>
  );
}

/* ─── Comment Item ──────────────────────────────────────────────── */

function CommentItem({ comment }: { comment: CsCommentWithUser }) {
  const tCommon = useTranslations("common");

  const userName =
    comment.user?.displayName || comment.user?.username || tCommon("system");

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{userName}</span>
        <span className="text-xs text-muted-foreground">
          {timeAgo(comment.createdAt)}
        </span>
      </div>
      {comment.content && (
        <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
      )}
      {comment.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {comment.attachments.map((url, i) => {
            const filename = url.split("/").pop() || "file";
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs text-blue-600 hover:underline"
              >
                <AttachmentIcon filename={filename} />
                <span className="max-w-[150px] truncate">{decodeFilename(filename)}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttachmentIcon({ filename }: { filename: string }) {
  const isImage = /\.(png|jpe?g|webp)$/i.test(filename);
  if (isImage) return <ImageIcon className="h-3 w-3 shrink-0" />;
  return <FileText className="h-3 w-3 shrink-0" />;
}

function decodeFilename(filename: string): string {
  return filename.replace(/^\d{10,}-/, "");
}
