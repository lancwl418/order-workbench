"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { StatusBadge } from "./status-badge";
import { formatDate } from "@/lib/utils";
import {
  INTERNAL_STATUSES,
  getNextStatus,
  getPrevStatus,
  STATUS_LABELS,
} from "@/lib/constants";
import type { OrderListItem } from "@/types";
import Link from "next/link";
import { ChevronRight, Undo2, Loader2 } from "lucide-react";

export function createColumns(opts: {
  onStatusChange: (orderId: string, newStatus: string) => Promise<void>;
  loadingId: string | null;
}): ColumnDef<OrderListItem>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "shopifyOrderNumber",
      header: "Order #",
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
      header: "Customer",
      cell: ({ row }) => (
        <div className="max-w-[150px] truncate">
          {row.getValue("customerName") || "-"}
        </div>
      ),
    },
    {
      accessorKey: "shopifyCreatedAt",
      header: "Date",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(row.getValue("shopifyCreatedAt"))}
        </span>
      ),
    },
    {
      accessorKey: "internalStatus",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.internalStatus;
        const id = row.original.id;
        const loading = opts.loadingId === id;

        return (
          <Select
            value={status}
            onValueChange={(v) => {
              if (v && v !== status) {
                opts.onStatusChange(id, v);
              }
            }}
            disabled={loading}
          >
            <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden">
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <StatusBadge status={status} />
              )}
            </SelectTrigger>
            <SelectContent>
              {INTERNAL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  <StatusBadge status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "shippingRoute",
      header: "Route",
      cell: ({ row }) => {
        const route = row.getValue("shippingRoute") as string;
        return route === "NOT_ASSIGNED" ? (
          <span className="text-muted-foreground text-sm">-</span>
        ) : (
          <StatusBadge status={route} />
        );
      },
    },
    {
      id: "tracking",
      header: "Tracking",
      cell: ({ row }) => {
        const tracking = row.original.trackingNumber;
        const shipment = row.original.shipments?.[0];
        const carrier = shipment?.carrier || row.original.carrier;
        const trackingUrl = shipment?.trackingUrl;
        const transitStatus = shipment?.status;

        if (!tracking) {
          return <span className="text-muted-foreground text-sm">-</span>;
        }

        return (
          <div className="space-y-0.5">
            {carrier && (
              <span className="text-xs font-medium text-muted-foreground block">
                {carrier}
              </span>
            )}
            {trackingUrl ? (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-primary hover:underline block max-w-[140px] truncate"
              >
                {tracking}
              </a>
            ) : (
              <span className="text-xs font-mono block max-w-[140px] truncate">
                {tracking}
              </span>
            )}
            {transitStatus && <StatusBadge status={transitStatus} />}
          </div>
        );
      },
    },
    {
      accessorKey: "totalPrice",
      header: "Total",
      cell: ({ row }) => {
        const price = row.getValue("totalPrice") as string | null;
        return (
          <span className="text-sm">
            {price ? `$${parseFloat(price).toFixed(2)}` : "-"}
          </span>
        );
      },
    },
    {
      id: "items",
      header: "Items",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.orderItems.length}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const status = row.original.internalStatus;
        const id = row.original.id;
        const loading = opts.loadingId === id;
        const next = getNextStatus(status);
        const prev = getPrevStatus(status);

        return (
          <div className="flex items-center gap-1">
            {prev && (
              <Button
                size="xs"
                variant="ghost"
                disabled={loading}
                onClick={() => opts.onStatusChange(id, prev)}
                title={`Revert to ${STATUS_LABELS[prev]}`}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Undo2 className="h-3 w-3" />
                )}
              </Button>
            )}
            {next && (
              <Button
                size="xs"
                variant="outline"
                disabled={loading}
                onClick={() => opts.onStatusChange(id, next)}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    {STATUS_LABELS[next]}
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
              </Button>
            )}
          </div>
        );
      },
    },
  ];
}
