"use client";

import { useState, useMemo, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useOrders } from "@/hooks/use-orders";
import { DataTable } from "@/components/orders/data-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { OrderListItem } from "@/types";
import Link from "next/link";
import { Printer, CheckCircle2, Loader2 } from "lucide-react";

export default function PrintQueuePage() {
  const {
    orders,
    pagination,
    isLoading,
    setPage,
    refresh,
  } = useOrders("print-queue");

  const [selectedOrders, setSelectedOrders] = useState<OrderListItem[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<string>("");
  const [batchLoading, setBatchLoading] = useState(false);

  const handlePrintAction = useCallback(
    async (orderId: string, action: "print_started" | "print_completed") => {
      setActionLoading(orderId);
      try {
        const res = await fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, action }),
        });
        if (!res.ok) throw new Error("Failed");
        toast.success(
          action === "print_started"
            ? "Print started"
            : "Marked as printed"
        );
        refresh();
      } catch {
        toast.error("Failed to update print status");
      } finally {
        setActionLoading(null);
      }
    },
    [refresh]
  );

  const columns: ColumnDef<OrderListItem>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
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
        id: "items",
        header: "Items",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.orderItems.length}
          </span>
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
        cell: ({ row }) => (
          <StatusBadge status={row.getValue("internalStatus")} />
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const status = row.original.internalStatus;
          const id = row.original.id;
          const loading = actionLoading === id;

          return (
            <div className="flex items-center gap-2">
              {status === "READY_TO_PRINT" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => handlePrintAction(id, "print_started")}
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Printer className="h-3 w-3" />
                  )}
                  Start Print
                </Button>
              )}
              {status === "PRINTING" && (
                <Button
                  size="sm"
                  disabled={loading}
                  onClick={() => handlePrintAction(id, "print_completed")}
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Mark Printed
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [actionLoading, handlePrintAction]
  );

  async function handleBatchAction() {
    if (!batchAction || selectedOrders.length === 0) return;

    setBatchLoading(true);
    try {
      const res = await fetch("/api/print/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrders.map((o) => o.id),
          action: batchAction,
        }),
      });

      if (!res.ok) throw new Error("Failed");

      const data = await res.json();
      toast.success(data.message);
      setBatchAction("");
      setSelectedOrders([]);
      refresh();
    } catch {
      toast.error("Batch action failed");
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Print Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Orders ready to print or currently printing
          </p>
        </div>
      </div>

      {selectedOrders.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-md mb-4">
          <span className="text-sm font-medium">
            {selectedOrders.length} selected
          </span>
          <Select
            value={batchAction}
            onValueChange={(v) => v && setBatchAction(v)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Batch action..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="print_started">Start Printing</SelectItem>
              <SelectItem value="print_completed">Mark Printed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleBatchAction}
            disabled={!batchAction || batchLoading}
          >
            {batchLoading ? "Applying..." : "Apply"}
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={orders}
        pagination={pagination}
        onPageChange={setPage}
        onRowSelectionChange={(rows) =>
          setSelectedOrders(rows as OrderListItem[])
        }
        isLoading={isLoading}
      />
    </div>
  );
}
