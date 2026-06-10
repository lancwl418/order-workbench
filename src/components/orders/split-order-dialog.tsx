"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, SplitSquareHorizontal } from "lucide-react";
import { toast } from "sonner";

interface SplitItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  itemType: string;
}

/** Default fulfillment group label for an item type. */
function defaultGroup(itemType: string): string {
  if (itemType === "free_sample") return "Free Sample";
  if (itemType === "transfer_by_size" || itemType === "gangsheet") return "Transfer";
  return "Blanks";
}

const GROUP_OPTIONS = ["Blanks", "Transfer", "Free Sample"] as const;

export function SplitOrderDialog({
  orderId,
  items,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderId: string;
  items: SplitItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const [groupOf, setGroupOf] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGroupOf(
      Object.fromEntries(items.map((i) => [i.id, defaultGroup(i.itemType)]))
    );
  }, [open, items]);

  // Build non-empty groups in a stable order.
  const groups = useMemo(() => {
    const byGroup = new Map<string, string[]>();
    for (const item of items) {
      const g = groupOf[item.id] ?? defaultGroup(item.itemType);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(item.id);
    }
    return byGroup;
  }, [items, groupOf]);

  const groupCount = groups.size;

  async function handleSplit() {
    if (groupCount < 2) {
      toast.error("Assign items to at least two different groups to split");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: [...groups.values()].map((orderItemIds) => ({ orderItemIds })),
        }),
      });
      const text = await res.text();
      let data: { error?: string; groups?: number } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          res.ok ? "Unexpected server response" : `Server error (HTTP ${res.status})`
        );
      }
      if (!res.ok) throw new Error(data.error || "Split failed");
      toast.success(`Split into ${data.groups} fulfillment group(s)`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Split failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SplitSquareHorizontal className="h-5 w-5" />
            Split Fulfillment
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Assign each line item to a group. Each group becomes its own Shopify
            fulfillment order so it can be fulfilled and tracked separately. This
            only affects fulfillment grouping — it does not touch printing or the
            factory push.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="border rounded-lg divide-y">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-3 flex items-center gap-3 justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.variantTitle && <span>{item.variantTitle} · </span>}
                    <span>SKU: {item.sku || "—"}</span>
                    <span> · × {item.quantity}</span>
                  </div>
                </div>
                <Select
                  value={groupOf[item.id] ?? defaultGroup(item.itemType)}
                  onValueChange={(v) =>
                    v && setGroupOf((prev) => ({ ...prev, [item.id]: v }))
                  }
                >
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUP_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {groupCount < 2
              ? "All items are in one group — assign them to at least two groups to split."
              : `Will create ${groupCount} fulfillment groups: ${[...groups.keys()].join(", ")}.`}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSplit} disabled={submitting || groupCount < 2}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Split
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
