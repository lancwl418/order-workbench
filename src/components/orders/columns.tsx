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
  PRINT_STATUSES,
  PRINT_STATUS_LABELS,
  PRINT_STATUS_COLORS,
  STATUS_LABELS,
} from "@/lib/constants";
import type { OrderListItem } from "@/types";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronRight, ChevronDown, Undo2, Loader2, PrinterCheck, MessageSquareText, Headset, ExternalLink, Tag } from "lucide-react";

export function createColumns(opts: {
  onStatusChange: (orderId: string, newStatus: string) => Promise<void>;
  onPrintStatusChange?: (orderId: string, newPrintStatus: string) => Promise<void>;
  onCsToggle?: (orderId: string, csFlag: boolean) => Promise<void>;
  loadingId: string | null;
  shopifyStoreDomain?: string;
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
      cell: ({ row }) => {
        const csFlag = row.original.csFlag;
        const note = row.original.notes;
        const id = row.original.id;
        const canToggle = true;

        return (
          <div className="flex items-center gap-1.5">
            <Link
              href={`/orders/${row.original.id}`}
              className="font-medium text-primary hover:underline"
            >
              #{row.getValue("shopifyOrderNumber") || row.original.id.slice(0, 8)}
            </Link>
            <TooltipProvider delay={200}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canToggle) opts.onCsToggle?.(id, !csFlag);
                      }}
                      className={`inline-flex items-center gap-0.5 rounded px-1 py-0 text-[10px] font-medium transition-colors ${
                        csFlag
                          ? canToggle
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            : "bg-amber-100 text-amber-700 cursor-default"
                          : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Headset className="h-2.5 w-2.5" />
                      CS
                    </button>
                  }
                />
                <TooltipContent>
                  {csFlag ? "Remove CS flag" : "Flag as CS order"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {note && (
              <TooltipProvider delay={200}>
                <Tooltip>
                  <TooltipTrigger
                    render={<MessageSquareText className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />}
                  />
                  <TooltipContent side="right" className="max-w-[300px]">
                    <p className="text-xs whitespace-pre-wrap">{note}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
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
      accessorKey: "internalStatus",
      header: "Order Status",
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
      id: "tracking",
      header: "Tracking",
      cell: ({ row }) => {
        const tracking = row.original.trackingNumber;
        const shipment = row.original.shipments?.[0];
        const carrier = shipment?.carrier || row.original.carrier;
        const trackingUrl = shipment?.trackingUrl;
        const transitStatus = shipment?.status;

        if (!tracking) {
          const shopifyOrderId = row.original.shopifyOrderId;
          const domain = opts.shopifyStoreDomain;

          return (
            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="outline" size="xs" className="gap-1 text-xs">
                    <Tag className="h-3 w-3" />
                    Create Label
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                }
              />
              <PopoverContent className="w-44 p-1" align="start">
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                  onClick={() => {
                    if (domain && shopifyOrderId) {
                      window.open(
                        `https://${domain}/admin/orders/${shopifyOrderId}`,
                        "_blank"
                      );
                    }
                  }}
                  disabled={!domain || !shopifyOrderId}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Shopify
                </button>
                <TooltipProvider delay={0}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground/50 cursor-not-allowed"
                          disabled
                        >
                          <Tag className="h-3.5 w-3.5" />
                          OMS
                        </button>
                      }
                    />
                    <TooltipContent side="right">Coming soon</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </PopoverContent>
            </Popover>
          );
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
      accessorKey: "printStatus",
      header: "Print Status",
      cell: ({ row }) => {
        const printStatus = row.original.printStatus;
        const id = row.original.id;
        const loading = opts.loadingId === id;
        const hasPrintFiles = row.original.orderItems.some(
          (item) => item.designFileUrl
        );
        const canQueue = hasPrintFiles && (printStatus === "NONE" || printStatus === "READY");

        const renderBadge = (s: string) => {
          if (s === "NONE") return <span className="text-muted-foreground text-sm">-</span>;
          const colors = PRINT_STATUS_COLORS[s] || { bg: "bg-gray-100", text: "text-gray-500" };
          return (
            <Badge variant="outline" className={`${colors.bg} ${colors.text} border-0 text-xs`}>
              {PRINT_STATUS_LABELS[s] || s}
            </Badge>
          );
        };

        const statusSelect = opts.onPrintStatusChange ? (
          <Select
            value={printStatus}
            onValueChange={(v) => {
              if (v && v !== printStatus) {
                opts.onPrintStatusChange!(id, v);
              }
            }}
            disabled={loading}
          >
            <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none focus:ring-0 [&>svg]:hidden">
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                renderBadge(printStatus)
              )}
            </SelectTrigger>
            <SelectContent>
              {PRINT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {renderBadge(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          renderBadge(printStatus)
        );

        return (
          <div className="flex items-center gap-1">
            {statusSelect}
            {!hasPrintFiles && (
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground border-dashed gap-1"
              >
                <PrinterCheck className="h-3 w-3" />
                No Print
              </Badge>
            )}
            {canQueue && opts.onPrintStatusChange && (
              <Button
                size="xs"
                variant="outline"
                disabled={loading}
                onClick={() => opts.onPrintStatusChange!(id, "IN_QUEUE")}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    Add to Queue
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
              </Button>
            )}
            {printStatus === "DONE" && opts.onPrintStatusChange && (
              <Button
                size="xs"
                variant="outline"
                disabled={loading}
                onClick={() => opts.onPrintStatusChange!(id, "IN_QUEUE")}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    Reprint / Add to Queue
                    <Undo2 className="h-3 w-3" />
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
