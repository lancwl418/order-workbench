"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MentionInput } from "@/components/cs/mention-input";
import { PrioritySelector } from "@/components/cs/priority-stars";
import { CS_ISSUE_TYPES } from "@/lib/constants";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type OrderResult = {
  id: string;
  shopifyOrderNumber: string | null;
  customerName: string | null;
};

export function CreateCsIssueDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const tCS = useTranslations("csQueue");
  const tIssue = useTranslations("csIssueType");
  const tCommon = useTranslations("common");

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderResult | null>(null);
  const [issueType, setIssueType] = useState("");
  const [priority, setPriority] = useState(0);
  const [comment, setComment] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchData } = useSWR<{ data: OrderResult[] }>(
    debouncedQuery.length >= 2
      ? `/api/orders?search=${encodeURIComponent(debouncedQuery)}&limit=10`
      : null,
    fetcher
  );

  const searchResults = searchData?.data || [];

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setDebouncedQuery("");
      setSelectedOrder(null);
      setIssueType("");
      setPriority(0);
      setComment("");
      setMentions([]);
    }
  }, [open]);

  async function handleSubmit() {
    if (!selectedOrder) return;
    setSubmitting(true);
    try {
      const patchBody: Record<string, unknown> = { csFlag: true };
      if (issueType) patchBody.csIssueType = issueType;
      if (priority > 0) patchBody.csPriority = priority;

      const res = await fetch(`/api/orders/${selectedOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) throw new Error("Failed to flag order");

      if (comment.trim()) {
        const commentRes = await fetch(
          `/api/orders/${selectedOrder.id}/cs-comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: comment.trim(),
              attachments: [],
              mentions,
            }),
          }
        );
        if (!commentRes.ok) throw new Error("Failed to add comment");
      }

      toast.success(tCS("summaryPanel.created"));
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Failed to create CS issue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tCS("summaryPanel.createIssue")}</DialogTitle>
          <DialogDescription>{tCS("flaggedDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Order Search */}
          <div className="space-y-2">
            <Label>{tCS("summaryPanel.selectOrder")}</Label>
            {selectedOrder ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">
                  #{selectedOrder.shopifyOrderNumber || selectedOrder.id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground">
                  {selectedOrder.customerName || ""}
                </span>
                <button
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedOrder(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative" ref={dropdownRef}>
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={tCS("summaryPanel.orderSearch")}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  className="pl-8"
                />
                {showDropdown && debouncedQuery.length >= 2 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {tCS("summaryPanel.noResults")}
                      </div>
                    ) : (
                      searchResults.map((order) => (
                        <button
                          key={order.id}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                          onClick={() => {
                            setSelectedOrder(order);
                            setSearchQuery("");
                            setShowDropdown(false);
                          }}
                        >
                          <span className="font-medium">
                            #{order.shopifyOrderNumber || order.id.slice(0, 8)}
                          </span>
                          <span className="text-muted-foreground truncate">
                            {order.customerName || ""}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Issue Type */}
          <div className="space-y-2">
            <Label>{tCS("flagDialog.issueType")}</Label>
            <Select value={issueType} onValueChange={(v) => setIssueType(v ?? "")}>
              <SelectTrigger className="w-full">
                {issueType ? (
                  <span>{tIssue.has(issueType) ? tIssue(issueType) : issueType}</span>
                ) : (
                  <span className="text-muted-foreground">{tCS("select")}</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {CS_ISSUE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {tIssue.has(type) ? tIssue(type) : type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label>{tCS("summaryPanel.priority")}</Label>
            <PrioritySelector value={priority} onChange={setPriority} />
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label>{tCS("flagDialog.comment")}</Label>
            <MentionInput
              value={comment}
              onChange={setComment}
              mentions={mentions}
              onMentionsChange={setMentions}
              placeholder={tCS("flagDialog.commentPlaceholder")}
              rows={3}
              className="text-sm"
              onSubmit={handleSubmit}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedOrder}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {tCS("summaryPanel.creating")}
              </>
            ) : (
              tCS("summaryPanel.createButton")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
