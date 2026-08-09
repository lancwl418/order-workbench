"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Factory, Send, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SupplierPushStatusBadge } from "./supplier-push-status-badge";
import {
  useBlanksData,
  usePushBlanks,
  type BlanksItem,
  type BlanksGroupResult,
  type PushBlanksItemPayload,
} from "./use-push-blanks";

// THE push dialog — order list, order detail and the blanks page all open
// this same component; it only needs an orderId and fetches its own data.

interface ItemFormState {
  orderItemId: string;
  selected: boolean;
  factorySku: string;
  sizeCode: string;
  colorCode: string;
  styleCode: string;
  craftType: 1 | 2;
  shouldPrint: boolean;
  printPosition: "1" | "2" | "1,2";
  imageUrlsText: string;
  effectImageUrlsText: string;
}

const SIZE_TOKENS = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL"];

function parseSizeFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  const parts = variantTitle.split("/").map((p) => p.trim());
  return parts.find((p) => SIZE_TOKENS.includes(p.toUpperCase())) || "";
}

function parseColorFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  const parts = variantTitle.split("/").map((p) => p.trim());
  return parts.find((p) => !SIZE_TOKENS.includes(p.toUpperCase())) || "";
}

function splitUrls(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export function PushBlanksDialog({
  orderId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const { data, isLoading, mutate } = useBlanksData(orderId, open);
  const { busy, pushBlanks, rePush, refreshStatus } = usePushBlanks();
  const [sellerRemark, setSellerRemark] = useState("");
  const [forms, setForms] = useState<Record<string, ItemFormState>>({});
  const [results, setResults] = useState<BlanksGroupResult[] | null>(null);
  const [pendingAction, setPendingAction] = useState<"place" | "place_and_push" | null>(null);

  useEffect(() => {
    if (!open || !data) return;
    setResults(null);
    setForms((prev) => {
      const next: Record<string, ItemFormState> = {};
      for (const item of data.items) {
        // Keep in-progress edits when SWR revalidates mid-edit
        if (prev[item.id]) {
          next[item.id] = prev[item.id];
          continue;
        }
        next[item.id] = {
          orderItemId: item.id,
          // Items already placed at a supplier can't be placed again
          selected: !item.supplierOrderNo && !!item.supplier,
          factorySku: item.prefill?.factorySku ?? item.sku ?? "",
          sizeCode: item.prefill?.factorySize ?? parseSizeFromVariant(item.variantTitle),
          colorCode: item.prefill?.factoryColor ?? parseColorFromVariant(item.variantTitle),
          styleCode: item.prefill?.factoryStyle ?? "",
          craftType: (item.prefill?.factoryCraftType as 1 | 2 | null) ?? 1,
          shouldPrint: item.printEnabled ?? false,
          printPosition: "1",
          imageUrlsText: item.designFileUrl ?? "",
          effectImageUrlsText: item.designFileUrl ?? "",
        };
      }
      return next;
    });
  }, [open, data]);

  const groups = useMemo(() => {
    if (!data) return [];
    const bySupplier = new Map<string, { key: string; name: string; items: BlanksItem[] }>();
    for (const item of data.items) {
      if (!item.supplier) continue;
      const g = bySupplier.get(item.supplier.id) ?? {
        key: item.supplier.key,
        name: item.supplier.name,
        items: [],
      };
      g.items.push(item);
      bySupplier.set(item.supplier.id, g);
    }
    return [...bySupplier.entries()].map(([id, g]) => ({ supplierId: id, ...g }));
  }, [data]);

  const unroutable = useMemo(
    () => (data?.items ?? []).filter((i) => i.unroutableReason),
    [data]
  );

  function updateForm(id: string, patch: Partial<ItemFormState>) {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function buildPayload(): PushBlanksItemPayload[] | null {
    const selected = Object.values(forms).filter((f) => f.selected);
    if (selected.length === 0) {
      toast.error("请至少选择一个 item / Select at least one item");
      return null;
    }
    for (const f of selected) {
      if (!f.factorySku.trim()) {
        toast.error("每个选中的 item 都需要 Factory SKU");
        return null;
      }
      if (f.shouldPrint && splitUrls(f.imageUrlsText).length === 0) {
        toast.error("打印的 item 需要打印图 URL");
        return null;
      }
    }
    return selected.map((f) => ({
      orderItemId: f.orderItemId,
      factorySku: f.factorySku.trim(),
      sizeCode: f.sizeCode || undefined,
      sizeName: f.sizeCode || undefined,
      colorCode: f.colorCode || undefined,
      colorName: f.colorCode || undefined,
      styleCode: f.styleCode || undefined,
      styleName: f.styleCode || undefined,
      craftType: f.craftType,
      shouldPrint: f.shouldPrint,
      printPosition: f.shouldPrint ? f.printPosition : undefined,
      imageUrls: f.shouldPrint ? splitUrls(f.imageUrlsText) : undefined,
      effectImageUrls: !f.shouldPrint ? splitUrls(f.effectImageUrlsText) : undefined,
    }));
  }

  async function handlePush(mode: "place" | "place_and_push") {
    const items = buildPayload();
    if (!items) return;
    setPendingAction(mode);
    const res = await pushBlanks(orderId, mode, items, sellerRemark);
    setPendingAction(null);
    if (!res) return;
    setResults(res.results);
    const failed = res.results.filter((r) => r.status === "failed");
    if (failed.length === 0) {
      toast.success(mode === "place" ? "已建单（未推送工厂）" : "已建单并推送工厂");
      onSuccess?.();
      onOpenChange(false);
    } else {
      // Keep the dialog open so per-group errors are visible
      toast.error(
        failed.map((r) => `${r.supplierName}: ${r.error ?? "推送失败"}`).join("\n"),
        { duration: 10000 }
      );
      mutate();
      onSuccess?.();
    }
  }

  async function handleRePush(pushId: string) {
    if (await rePush(pushId)) {
      mutate();
      onSuccess?.();
    }
  }

  async function handleRefreshStatus() {
    if (await refreshStatus(orderId)) {
      mutate();
      onSuccess?.();
    }
  }

  const resultByOid = new Map((results ?? []).map((r) => [r.platformOid, r]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5" />
            推送 Blanks {data?.orderNumber ? `· #${data.orderNumber}` : ""}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            按供应商分组推送白板订单。默认不打印、工艺白墨烫画。
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Existing pushes */}
            {data.pushes.length > 0 && (
              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">已有推送记录</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={handleRefreshStatus}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    刷新状态
                  </Button>
                </div>
                {data.pushes.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-medium">{p.supplierName}</span>
                    <span className="font-mono text-muted-foreground">{p.platformOid}</span>
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
                        推送工厂
                      </Button>
                    )}
                    {p.lastError && (
                      <span className="text-red-600 w-full">{p.lastError}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Unroutable items */}
            {unroutable.length > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  以下 item 无法路由到供应商，需先配置 vendor 映射：
                </div>
                {unroutable.map((item) => (
                  <div key={item.id} className="text-amber-800">
                    · {item.title} —{" "}
                    {item.unroutableReason === "no_vendor"
                      ? "商品没有 vendor"
                      : `vendor "${item.vendor}" 未映射`}
                  </div>
                ))}
                <Link href="/blanks/settings" className="text-amber-900 underline">
                  去配置供应商 / vendor 映射 →
                </Link>
              </div>
            )}

            {/* Seller remark */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                卖家备注（可选）
              </label>
              <Input
                value={sellerRemark}
                onChange={(e) => setSellerRemark(e.target.value)}
                placeholder="Note for factory"
                className="h-9"
              />
            </div>

            {/* Supplier groups */}
            {groups.map((group) => {
              const groupResult = [...resultByOid.values()].find(
                (r) => r.supplierId === group.supplierId
              );
              return (
                <div key={group.supplierId} className="border rounded-lg">
                  <div className="px-3 py-2 border-b bg-muted/40 flex items-center gap-2 flex-wrap">
                    <Factory className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">{group.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {group.items.length} item{group.items.length > 1 ? "s" : ""}
                    </span>
                    {groupResult && (
                      <span
                        className={
                          groupResult.status === "failed"
                            ? "text-xs text-red-600"
                            : "text-xs text-green-600"
                        }
                      >
                        {groupResult.status === "pushed" && "✓ 已建单并推送"}
                        {groupResult.status === "placed" &&
                          (groupResult.pushError
                            ? `已建单，推送失败：${groupResult.pushError}`
                            : "✓ 已建单（未推送）")}
                        {groupResult.status === "failed" && `✗ ${groupResult.error}`}
                      </span>
                    )}
                  </div>
                  <div className="divide-y">
                    {group.items.map((item) => {
                      const f = forms[item.id];
                      if (!f) return null;
                      const alreadyPlaced = !!item.supplierOrderNo;
                      return (
                        <div key={item.id} className="p-3 space-y-2">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={f.selected}
                              disabled={alreadyPlaced}
                              onCheckedChange={(v) => updateForm(item.id, { selected: !!v })}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium truncate">{item.title}</span>
                                <span className="text-xs text-muted-foreground">× {item.quantity}</span>
                                {item.vendor && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                                    {item.vendor}
                                  </span>
                                )}
                                {alreadyPlaced && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                    已建单 {item.supplierOrderNo}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {item.variantTitle && <span>{item.variantTitle} · </span>}
                                <span>Our SKU: {item.sku || "—"}</span>
                              </div>
                            </div>
                          </div>

                          {f.selected && !alreadyPlaced && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pl-7">
                              <div className="col-span-2">
                                <label className="text-[11px] text-muted-foreground">Factory SKU *</label>
                                <Input
                                  value={f.factorySku}
                                  onChange={(e) => updateForm(item.id, { factorySku: e.target.value })}
                                  className="h-8 text-sm font-mono"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground">Size</label>
                                <Input
                                  value={f.sizeCode}
                                  onChange={(e) => updateForm(item.id, { sizeCode: e.target.value })}
                                  placeholder="XL"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground">Color</label>
                                <Input
                                  value={f.colorCode}
                                  onChange={(e) => updateForm(item.id, { colorCode: e.target.value })}
                                  placeholder="BL01"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[11px] text-muted-foreground">Style (款号)</label>
                                <Input
                                  value={f.styleCode}
                                  onChange={(e) => updateForm(item.id, { styleCode: e.target.value })}
                                  placeholder="默认用 Factory SKU"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[11px] text-muted-foreground">工艺</label>
                                <Select
                                  value={String(f.craftType)}
                                  onValueChange={(v) =>
                                    updateForm(item.id, { craftType: Number(v) as 1 | 2 })
                                  }
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1">白墨烫画（默认）</SelectItem>
                                    <SelectItem value="2">白墨直喷</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="md:col-span-4 flex items-center gap-2 pt-1 border-t">
                                <Checkbox
                                  checked={f.shouldPrint}
                                  onCheckedChange={(v) => updateForm(item.id, { shouldPrint: !!v })}
                                />
                                <span className="text-xs">打印 Print（默认不打印）</span>
                              </div>

                              {f.shouldPrint ? (
                                <>
                                  <div className="md:col-span-2">
                                    <label className="text-[11px] text-muted-foreground">打印位置</label>
                                    <Select
                                      value={f.printPosition}
                                      onValueChange={(v) =>
                                        updateForm(item.id, { printPosition: v as "1" | "2" | "1,2" })
                                      }
                                    >
                                      <SelectTrigger className="h-8 text-sm">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="1">前 Front</SelectItem>
                                        <SelectItem value="2">后 Back</SelectItem>
                                        <SelectItem value="1,2">前后 Both</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="text-[11px] text-muted-foreground">
                                      打印图 URLs（png，逗号分隔）*
                                    </label>
                                    <Input
                                      value={f.imageUrlsText}
                                      onChange={(e) =>
                                        updateForm(item.id, { imageUrlsText: e.target.value })
                                      }
                                      placeholder="https://..., https://..."
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                </>
                              ) : (
                                <div className="md:col-span-4">
                                  <label className="text-[11px] text-muted-foreground">
                                    效果图 URLs（可选，最多 2 张，逗号分隔）
                                  </label>
                                  <Input
                                    value={f.effectImageUrlsText}
                                    onChange={(e) =>
                                      updateForm(item.id, { effectImageUrlsText: e.target.value })
                                    }
                                    placeholder="https://xxx.com/image.jpg（可留空）"
                                    className="h-8 text-sm"
                                  />
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    纯白板可不传；若工厂要求效果图导致推送失败，补上后重推即可
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {groups.length === 0 && unroutable.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                该订单没有 blank items
              </p>
            )}

            {/* Actions: place only vs place + push */}
            {groups.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => handlePush("place")} disabled={busy}>
                  {pendingAction === "place" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Factory className="h-4 w-4 mr-2" />
                  )}
                  仅建单
                </Button>
                <Button onClick={() => handlePush("place_and_push")} disabled={busy}>
                  {pendingAction === "place_and_push" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  建单并推送工厂
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
