"use client";

import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS } from "@/lib/constants";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const t = useTranslations("status");
  const colors = STATUS_COLORS[status] || {
    bg: "bg-gray-100",
    text: "text-gray-600",
  };
  const label = t.has(status) ? t(status) : status;

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium border-0",
        colors.bg,
        colors.text,
        className
      )}
    >
      {label}
    </Badge>
  );
}
