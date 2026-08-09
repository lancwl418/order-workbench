"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { format } from "date-fns";
import {
  ChevronDown,
  ExternalLink,
  Factory,
  Loader2,
  RefreshCw,
  Send,
  Settings,
  Shirt,
  Tag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusBadge } from "@/components/orders/status-badge";
import { OmsPushDialog } from "@/components/orders/oms-push-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PushBlanksDialog } from "./push-blanks-dialog";
import { SupplierPushStatusBadge } from "./supplier-push-status-badge";
import { usePushBlanks, type BlanksPush } from "./use-push-blanks";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BlanksOrderRow {
  id: string;
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  customerName: string | null;
  internalStatus: string;
  labelStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  shopifyCreatedAt: string | null;
  orderItems: {
    id: string;
    title: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
    vendor: string | null;
    printEnabled: boolean;
    supplierOrderNo: string | null;
    supplierPushedAt: string | null;
  }[];
  supplierPushes: (Omit<BlanksPush, "supplierKey" | "supplierName"> & {
    supplier: { id: string; key: string; name: string };
  })[];
}

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "unpushed", label: "未推送" },
  { value: "placed", label: "已建单未推送" },
  { value: "pushed", label: "已推送" },
  { value: "rejected", label: "被反审" },
];

export function BlanksPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialogOrderId, setDialogOrderId] = useState<string | null>(null);
  const [omsPushOrderId, setOmsPushOrderId] = useState<string | null>(null);

  const { busy, rePush, refreshStatus } = usePushBlanks();

  const { data, isLoading, mutate } = useSWR<{
    orders: BlanksOrderRow[];
    total: number;
    totalPages: number;
  }>(
    `/api/blanks-orders?page=${page}&filter=${filter}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
    fetcher
  );

  async function handleRefreshAll() {
    if (await refreshStatus()) mutate();
  }

  async function handleRefreshOrder(orderId: string) {
    if (await refreshStatus(orderId)) mutate();
  }

  async function handleRePush(pushId: string) {
    if (await rePush(pushId)) mutate();
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Shirt className="h-5 w-5" />
          Blanks 推送
        </h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleRefreshAll} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            刷新全部状态
          </Button>
          <Link href="/blanks/settings">
            <Button size="sm" variant="ghost">
              <Settings className="h-3.5 w-3.5 mr-1" />
              供应商设置
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索订单号…"
            className="h-9 w-48"
          />
          <Button type="submit" size="sm" variant="secondary">
            搜索
          </Button>
        </form>
        <Select
          value={filter}
          onValueChange={(v) => {
            setPage(1);
            setFilter(v ?? "all");
          }}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && (
          <span className="text-xs text-muted-foreground">{data.total} 单</span>
        )}
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单</TableHead>
              <TableHead>订单状态</TableHead>
              <TableHead>Blank Items</TableHead>
              <TableHead>供应商 / 状态</TableHead>
              <TableHead>Label / 物流</TableHead>
              <TableHead>状态同步</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data?.orders ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                  没有符合条件的订单
                </TableCell>
              </TableRow>
            )}
            {(data?.orders ?? []).map((order) => (
              <TableRow key={order.id}>
                <TableCell className="align-top">
                  <Link
                    href={`/orders/${order.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    #{order.shopifyOrderNumber ?? order.id.slice(0, 8)}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {order.customerName}
                    {order.shopifyCreatedAt && (
                      <> · {format(new Date(order.shopifyCreatedAt), "MM-dd")}</>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <StatusBadge status={order.internalStatus} className="text-[11px]" />
                </TableCell>
                <TableCell className="align-top">
                  <div className="space-y-0.5">
                    {order.orderItems.map((item) => (
                      <div key={item.id} className="text-xs flex items-center gap-1.5 flex-wrap">
                        <span className="truncate max-w-[220px]">{item.title}</span>
                        {item.variantTitle && (
                          <span className="font-medium text-purple-700">{item.variantTitle}</span>
                        )}
                        <span className="text-muted-foreground">× {item.quantity}</span>
                        {item.vendor && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {item.vendor}
                          </Badge>
                        )}
                        {item.printEnabled && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-700">
                            打印
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  {order.supplierPushes.length === 0 ? (
                    <span className="text-xs text-muted-foreground">未推送</span>
                  ) : (
                    <div className="space-y-1">
                      {order.supplierPushes.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-medium">{p.supplier.name}</span>
                          <SupplierPushStatusBadge push={p} />
                          {!p.pushedAt && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2"
                              disabled={busy}
                              onClick={() => handleRePush(p.id)}
                            >
                              <Send className="h-3 w-3 mr-1" />
                              推送
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {order.trackingNumber ? (
                    <div className="space-y-0.5">
                      {order.carrier && (
                        <span className="text-xs font-medium text-muted-foreground block">
                          {order.carrier}
                        </span>
                      )}
                      <span className="text-xs font-mono block max-w-[140px] truncate">
                        {order.trackingNumber}
                      </span>
                    </div>
                  ) : (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
                            <Tag className="h-3 w-3" />
                            创建 Label
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        }
                      />
                      <PopoverContent className="w-44 p-1" align="start">
                        <button
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                          onClick={() => {
                            const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
                            if (domain && order.shopifyOrderId) {
                              window.open(
                                `https://${domain}/admin/orders/${order.shopifyOrderId}`,
                                "_blank"
                              );
                            }
                          }}
                          disabled={!process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || !order.shopifyOrderId}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Shopify
                        </button>
                        <button
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                          onClick={() => setOmsPushOrderId(order.id)}
                        >
                          <Tag className="h-3.5 w-3.5" />
                          OMS
                        </button>
                      </PopoverContent>
                    </Popover>
                  )}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">
                  {order.supplierPushes.find((p) => p.statusSyncedAt)
                    ? format(
                        new Date(
                          Math.max(
                            ...order.supplierPushes
                              .filter((p) => p.statusSyncedAt)
                              .map((p) => new Date(p.statusSyncedAt!).getTime())
                          )
                        ),
                        "MM-dd HH:mm"
                      )
                    : "—"}
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex items-center justify-end gap-1">
                    {order.supplierPushes.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        title="刷新该订单状态"
                        disabled={busy}
                        onClick={() => handleRefreshOrder(order.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialogOrderId(order.id)}
                    >
                      <Factory className="h-3.5 w-3.5 mr-1" />
                      推送
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            {page} / {data.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {dialogOrderId && (
        <PushBlanksDialog
          orderId={dialogOrderId}
          open={!!dialogOrderId}
          onOpenChange={(open) => {
            if (!open) setDialogOrderId(null);
          }}
          onSuccess={() => mutate()}
        />
      )}

      {/* OMS label dialog — same shared component as the orders page */}
      {omsPushOrderId && (
        <OmsPushDialog
          orderId={omsPushOrderId}
          open={!!omsPushOrderId}
          onOpenChange={(open) => {
            if (!open) setOmsPushOrderId(null);
          }}
          onSuccess={() => {
            setOmsPushOrderId(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}
