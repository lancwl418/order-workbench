"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("blanks");

  let label: string;
  if (push.orderStatus !== null) {
    // Known status codes are translated; unknown ones fall back to the
    // factory-provided string, then to a generic "Status N".
    const key = `s${push.orderStatus}`.replace("-", "m");
    if (t.has(key)) {
      label = t(key);
    } else if (push.orderStatusStr) {
      label = push.orderStatusStr;
    } else {
      label = t("statusN", { n: push.orderStatus });
    }
  } else {
    label = push.pushedAt ? t("statusPushed") : t("statusPlaced");
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap",
        badgeClass(push),
        className
      )}
      title={push.lastError ?? undefined}
    >
      {label}
      {push.lastError && <span aria-hidden>⚠</span>}
    </span>
  );
}
