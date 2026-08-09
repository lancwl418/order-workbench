"use client";

import { cn } from "@/lib/utils";
import { REJECTED_ORDER_STATUS } from "@/lib/suppliers/types";

// The one status badge for supplier pushes — used by the order detail page,
// the blanks page, and the push dialog. Don't duplicate this rendering.

export interface SupplierPushStatus {
  pushedAt: string | Date | null;
  orderStatus: number | null;
  orderStatusStr: string | null;
  lastError?: string | null;
}

export function supplierPushLabel(push: SupplierPushStatus): string {
  if (push.orderStatus !== null && push.orderStatusStr) {
    return push.orderStatusStr;
  }
  if (push.orderStatus !== null) return `状态 ${push.orderStatus}`;
  return push.pushedAt ? "已推送" : "已建单未推送";
}

function badgeClass(push: SupplierPushStatus): string {
  if (push.orderStatus === REJECTED_ORDER_STATUS) {
    // Sent back by the factory — the state that needs operator attention
    return "bg-red-100 text-red-700 border-red-200";
  }
  if (push.orderStatus === 12) return "bg-green-100 text-green-700 border-green-200";
  if (push.orderStatus === 13 || push.orderStatus === 14 || push.orderStatus === 15) {
    return "bg-gray-100 text-gray-600 border-gray-200";
  }
  if (push.orderStatus !== null) return "bg-blue-100 text-blue-700 border-blue-200";
  if (!push.pushedAt) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-blue-100 text-blue-700 border-blue-200";
}

export function SupplierPushStatusBadge({
  push,
  className,
}: {
  push: SupplierPushStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap",
        badgeClass(push),
        className
      )}
      title={push.lastError ?? undefined}
    >
      {supplierPushLabel(push)}
      {push.lastError && <span aria-hidden>⚠</span>}
    </span>
  );
}
