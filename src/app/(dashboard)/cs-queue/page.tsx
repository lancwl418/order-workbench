"use client";

import { useMemo, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useOrders } from "@/hooks/use-orders";
import { DataTable } from "@/components/orders/data-table";
import { StatusBadge } from "@/components/orders/status-badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { OrderListItem } from "@/types";
import Link from "next/link";
import { Star, Flag, Loader2 } from "lucide-react";

function PriorityStars({ priority }: { priority: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < priority
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

export default function CSQueuePage() {
  const {
    orders,
    pagination,
    isLoading,
    setPage,
    setSort,
    refresh,
  } = useOrders("cs-queue");

  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleResolve = useCallback(
    async (orderId: string) => {
      setResolvingId(orderId);
      try {
        const res = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csFlag: false }),
        });
        if (!res.ok) throw new Error("Failed to resolve");
        toast.success("CS flag removed");
        refresh();
      } catch {
        toast.error("Failed to resolve CS issue");
      } finally {
        setResolvingId(null);
      }
    },
    [refresh]
  );

  const columns: ColumnDef<OrderListItem>[] = useMemo(
    () => [
      {
        accessorKey: "csPriority",
        header: "Priority",
        cell: ({ row }) => (
          <PriorityStars priority={row.original.csPriority || 0} />
        ),
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
        accessorKey: "internalStatus",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge status={row.getValue("internalStatus")} />
        ),
      },
      {
        accessorKey: "csIssueType",
        header: "Issue Type",
        cell: ({ row }) => {
          const issueType = row.original.csIssueType;
          return issueType ? (
            <span className="text-sm capitalize">
              {issueType.replace(/_/g, " ")}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          );
        },
      },
      {
        accessorKey: "csNote",
        header: "CS Note",
        cell: ({ row }) => {
          const note = row.original.csNote;
          return note ? (
            <div className="max-w-[200px] truncate text-sm text-muted-foreground">
              {note}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          );
        },
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
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const id = row.original.id;
          const loading = resolvingId === id;

          return (
            <div className="flex items-center gap-2">
              <Link href={`/orders/${id}`}>
                <Button size="sm" variant="outline">
                  View
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading}
                onClick={() => handleResolve(id)}
                title="Remove CS flag"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Flag className="h-3 w-3" />
                )}
                Resolve
              </Button>
            </div>
          );
        },
      },
    ],
    [resolvingId, handleResolve]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Customer Service Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Orders flagged for customer service attention
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSort("csPriority", "desc")}
        >
          Sort by Priority
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={orders}
        pagination={pagination}
        onPageChange={setPage}
        isLoading={isLoading}
      />
    </div>
  );
}
