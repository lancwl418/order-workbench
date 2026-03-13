"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPE_COLORS,
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_COLORS,
  EXCEPTION_SEVERITY_COLORS,
  STATUS_LABELS,
} from "@/lib/constants";
import { timeAgo } from "@/lib/utils";
import type { ExceptionWithRelations } from "@/types";
import { Search, CheckCircle2, User } from "lucide-react";

export function ExceptionCard({
  exception,
  onInvestigate,
  onResolve,
}: {
  exception: ExceptionWithRelations;
  onInvestigate: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const typeColor =
    EXCEPTION_TYPE_COLORS[exception.type] || { bg: "bg-gray-100", text: "text-gray-700" };
  const statusColor =
    EXCEPTION_STATUS_COLORS[exception.status] || { bg: "bg-gray-100", text: "text-gray-700" };
  const severityColor =
    EXCEPTION_SEVERITY_COLORS[exception.severity] || { bg: "bg-gray-100", text: "text-gray-700" };

  return (
    <Card className="border">
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        {/* Header: order link + badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <Link
              href={`/orders/${exception.order.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              #{exception.order.shopifyOrderNumber || exception.order.id.slice(0, 8)}
            </Link>
            {exception.order.customerName && (
              <p className="text-xs text-muted-foreground">
                {exception.order.customerName}
              </p>
            )}
          </div>
          <Badge
            variant="outline"
            className={`${severityColor.bg} ${severityColor.text} border-0 text-[10px] px-1.5`}
          >
            {exception.severity}
          </Badge>
        </div>

        {/* Exception type + status */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={`${typeColor.bg} ${typeColor.text} border-0 text-[10px]`}
          >
            {EXCEPTION_TYPE_LABELS[exception.type] || exception.type}
          </Badge>
          <Badge
            variant="outline"
            className={`${statusColor.bg} ${statusColor.text} border-0 text-[10px]`}
          >
            {EXCEPTION_STATUS_LABELS[exception.status] || exception.status}
          </Badge>
        </div>

        {/* Days count - prominent */}
        {exception.daysSinceLabel != null && (
          <p className="text-sm font-semibold text-red-600">
            {exception.daysSinceLabel} days
          </p>
        )}
        {exception.transitDays != null && (
          <p className="text-sm font-semibold text-amber-600">
            {exception.transitDays} business days in transit
          </p>
        )}
        {exception.hoursSincePaid != null && (
          <p className="text-sm font-semibold text-purple-600">
            {Math.floor(exception.hoursSincePaid / 24)}d {exception.hoursSincePaid % 24}h since paid
          </p>
        )}

        {/* Context info */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          {exception.shipment && (
            <p>
              {exception.shipment.carrier && `${exception.shipment.carrier} - `}
              {exception.shipment.trackingNumber || "No tracking"}
            </p>
          )}
          {exception.shipment?.shippedAt && (
            <p>
              Fulfilled {new Date(exception.shipment.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          )}
          <p className="text-muted-foreground/70">
            Detected {timeAgo(exception.detectedAt)}
          </p>
          {exception.order.internalStatus && (
            <p>
              Order status: {STATUS_LABELS[exception.order.internalStatus] || exception.order.internalStatus}
            </p>
          )}
        </div>

        {/* Owner */}
        {exception.owner && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{exception.owner}</span>
          </div>
        )}

        {/* Note */}
        {exception.note && (
          <p className="text-xs bg-muted/50 rounded p-1.5 text-muted-foreground">
            {exception.note}
          </p>
        )}

        {/* Actions */}
        {(exception.status === "OPEN" || exception.status === "INVESTIGATING") && (
          <div className="flex items-center gap-1.5 pt-1">
            {exception.status === "OPEN" && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onInvestigate(exception.id)}
              >
                <Search className="h-3 w-3" />
                Investigate
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              onClick={() => onResolve(exception.id)}
            >
              <CheckCircle2 className="h-3 w-3" />
              Resolve
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
