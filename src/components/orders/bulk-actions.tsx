"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTERNAL_STATUSES, STATUS_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import type { OrderListItem } from "@/types";

interface BulkActionsProps {
  selectedOrders: OrderListItem[];
  onComplete: () => void;
}

export function BulkActions({ selectedOrders, onComplete }: BulkActionsProps) {
  const [newStatus, setNewStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  if (selectedOrders.length === 0) return null;

  async function handleApply() {
    if (!newStatus) return;
    setLoading(true);

    try {
      const res = await fetch("/api/orders/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrders.map((o) => o.id),
          internalStatus: newStatus,
        }),
      });

      if (!res.ok) throw new Error("Failed to update");

      const data = await res.json();
      toast.success(data.message);
      setNewStatus("");
      onComplete();
    } catch {
      toast.error("Failed to update orders");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md mb-4">
      <span className="text-sm font-medium">
        {selectedOrders.length} selected
      </span>
      <Select value={newStatus} onValueChange={(v) => v && setNewStatus(v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Set status..." />
        </SelectTrigger>
        <SelectContent>
          {INTERNAL_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={handleApply} disabled={!newStatus || loading}>
        {loading ? "Applying..." : "Apply"}
      </Button>
    </div>
  );
}
