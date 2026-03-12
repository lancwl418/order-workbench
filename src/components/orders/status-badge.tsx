"use client";

import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] || {
    bg: "bg-gray-100",
    text: "text-gray-600",
  };
  const label = STATUS_LABELS[status] || status;

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
