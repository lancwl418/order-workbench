"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import type { PrintGroupWithItems } from "@/types";

const PAGE_SIZE = 20;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PrintHistoryPage() {
  const tPQ = useTranslations("printQueue");
  const tCommon = useTranslations("common");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSWR<{
    groups: PrintGroupWithItems[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/print-groups?status=PRINTED&page=${page}&limit=${PAGE_SIZE}`, fetcher);

  const groups = data?.groups || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Group by date
  const groupedByDate = useMemo(() => {
    const map = new Map<string, PrintGroupWithItems[]>();
    for (const group of groups) {
      const dateKey = new Date(group.updatedAt).toLocaleDateString("en-CA"); // YYYY-MM-DD
      const existing = map.get(dateKey);
      if (existing) {
        existing.push(group);
      } else {
        map.set(dateKey, [group]);
      }
    }
    return [...map.entries()];
  }, [groups]);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/print-queue">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {tCommon("back")}
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{tPQ("printHistory")}</h1>
          <p className="text-sm text-muted-foreground">{tPQ("printHistoryDescription")}</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-40 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {tCommon("loading")}
        </div>
      )}

      {!isLoading && groups.length === 0 && (
        <p className="text-muted-foreground text-center py-12">
          {tPQ("noHistory")}
        </p>
      )}

      {groupedByDate.map(([dateKey, dateGroups]) => (
        <div key={dateKey} className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            {new Date(dateKey + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <div className="space-y-2">
            {dateGroups.map((group) => (
              <PrintedGroupCard key={group.id} group={group} />
            ))}
          </div>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            &larr;
          </Button>
          <span className="text-sm text-muted-foreground">
            {tCommon("page")} {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            &rarr;
          </Button>
        </div>
      )}
    </div>
  );
}

function PrintedGroupCard({ group }: { group: PrintGroupWithItems }) {
  const tPQ = useTranslations("printQueue");
  const [expanded, setExpanded] = useState(false);

  const orderMap = new Map<
    string,
    { orderNumber: string | null; customerName: string | null; files: typeof group.items }
  >();
  for (const item of group.items) {
    const existing = orderMap.get(item.orderId);
    if (existing) {
      existing.files.push(item);
    } else {
      orderMap.set(item.orderId, {
        orderNumber: item.order.shopifyOrderNumber,
        customerName: item.order.customerName,
        files: [item],
      });
    }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            <span className="font-medium">{group.name}</span>
            <Badge variant="secondary">{tPQ("printed")}</Badge>
            <span className="text-sm text-muted-foreground">
              {orderMap.size} {orderMap.size !== 1 ? tPQ("orders_count") : tPQ("order")} &middot;{" "}
              {group.items.length} {group.items.length !== 1 ? tPQ("files") : tPQ("file")} &middot;{" "}
              {group.totalHeight.toFixed(1)}&quot;
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(group.updatedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </div>

        {expanded && (
          <div className="mt-3 pl-7 space-y-3">
            {[...orderMap.entries()].map(([orderId, data]) => {
              const orderHeight = data.files.reduce(
                (sum, f) => sum + f.heightInches, 0
              );
              return (
                <div key={orderId} className="space-y-1">
                  <div className="flex items-center gap-3 text-sm">
                    <Link
                      href={`/orders/${orderId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      #{data.orderNumber || orderId.slice(0, 8)}
                    </Link>
                    <span className="text-muted-foreground">
                      {data.customerName || "-"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {orderHeight.toFixed(1)}&quot;
                    </span>
                  </div>
                  <div className="pl-4 space-y-0.5">
                    {data.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <a
                          href={file.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline truncate max-w-[300px] flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {file.filename}
                        </a>
                        <span className="text-muted-foreground shrink-0">
                          {file.widthPx}&times;{file.heightPx}px &middot;{" "}
                          {file.heightInches.toFixed(1)}&quot;
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
