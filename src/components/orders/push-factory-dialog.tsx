"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Factory } from "lucide-react";
import { toast } from "sonner";

interface OrderItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  itemType: string;
  designFileUrl?: string | null;
  factorySku?: string | null;
  factorySize?: string | null;
  factoryColor?: string | null;
  factoryStyle?: string | null;
  factoryCraftType?: number | null;
}

interface MappingLookup {
  factorySku: string;
  factorySize: string | null;
  factoryColor: string | null;
  factoryStyle: string | null;
  factoryCraftType: number | null;
}

interface ItemFormState {
  orderItemId: string;
  selected: boolean;
  factorySku: string;
  sizeCode: string;
  colorCode: string;
  styleCode: string;
  craftType: 1 | 2 | null; // null = use global default
  shouldPrint: boolean;
  printPosition: "1" | "2" | "1,2";
  imageUrlsText: string; // comma-separated when shouldPrint=true
  effectImageUrlsText: string; // comma-separated effect images for non-print items
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function parseSizeFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  // Shopify variant titles look like "Black / XL" or "XL / Black" or "XL"
  const parts = variantTitle.split("/").map((p) => p.trim());
  const sizeTokens = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL"];
  return parts.find((p) => sizeTokens.includes(p.toUpperCase())) || "";
}

function parseColorFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  const parts = variantTitle.split("/").map((p) => p.trim());
  const sizeTokens = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL"];
  return parts.find((p) => !sizeTokens.includes(p.toUpperCase())) || "";
}

export function PushFactoryDialog({
  orderId,
  items,
  open,
  onOpenChange,
  onSuccess,
}: {
  orderId: string;
  items: OrderItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}) {
  const [craftType, setCraftType] = useState<1 | 2>(1);
  const [sellerRemark, setSellerRemark] = useState("");
  const [pushing, setPushing] = useState(false);
  const [forms, setForms] = useState<ItemFormState[]>([]);

  const { data: mappingData } = useSWR<{ mappings: Record<string, MappingLookup> }>(
    open && orderId ? `/api/sku-mappings?orderId=${orderId}` : null,
    fetcher
  );

  useEffect(() => {
    if (!open) return;
    const mappings = mappingData?.mappings ?? {};
    setForms(
      items.map((item) => {
        const m = mappings[item.id];
        const storedSku = item.factorySku ?? m?.factorySku ?? item.sku ?? "";
        const storedSize = item.factorySize ?? m?.factorySize ?? parseSizeFromVariant(item.variantTitle);
        const storedColor = item.factoryColor ?? m?.factoryColor ?? parseColorFromVariant(item.variantTitle);
        const storedStyle = item.factoryStyle ?? m?.factoryStyle ?? "";
        const storedCraft = (item.factoryCraftType ?? m?.factoryCraftType ?? null) as 1 | 2 | null;
        return {
          orderItemId: item.id,
          selected: item.itemType === "other",
          factorySku: storedSku,
          sizeCode: storedSize,
          colorCode: storedColor,
          styleCode: storedStyle,
          craftType: storedCraft,
          shouldPrint: item.itemType !== "other", // blanks default to no print
          printPosition: "1",
          imageUrlsText: item.designFileUrl ?? "",
          effectImageUrlsText: item.designFileUrl ?? "",
        };
      })
    );
  }, [open, items, mappingData]);

  function updateForm(id: string, patch: Partial<ItemFormState>) {
    setForms((prev) => prev.map((f) => (f.orderItemId === id ? { ...f, ...patch } : f)));
  }

  async function handlePush() {
    const selected = forms.filter((f) => f.selected);
    if (selected.length === 0) {
      toast.error("Select at least one item to push");
      return;
    }
    const missing = selected.find((f) => !f.factorySku.trim());
    if (missing) {
      toast.error("Every selected item needs a factory SKU");
      return;
    }

    setPushing(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/push-factory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          craftType,
          platformType: 15,
          sellerRemark: sellerRemark || undefined,
          items: selected.map((f) => ({
            orderItemId: f.orderItemId,
            factorySku: f.factorySku.trim(),
            sizeCode: f.sizeCode || undefined,
            sizeName: f.sizeCode || undefined,
            colorCode: f.colorCode || undefined,
            colorName: f.colorCode || undefined,
            styleCode: f.styleCode || undefined,
            styleName: f.styleCode || undefined,
            craftType: f.craftType ?? undefined,
            shouldPrint: f.shouldPrint,
            printPosition: f.shouldPrint ? f.printPosition : undefined,
            imageUrls: f.shouldPrint
              ? f.imageUrlsText
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
            effectImageUrls: !f.shouldPrint
              ? f.effectImageUrlsText
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Push failed");
      }
      toast.success(`Pushed to factory${data.traceId ? ` | trace ${data.traceId}` : ""}`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5" />
            Push to Factory
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Review and edit the factory SKU for each line item. Blank items are selected by default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Global controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Default craft type</label>
              <Select
                value={String(craftType)}
                onValueChange={(v) => setCraftType(Number(v) as 1 | 2)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">白墨烫画 (heat transfer)</SelectItem>
                  <SelectItem value="2">白墨直喷 (DTG)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Seller remark (optional)</label>
              <Input
                value={sellerRemark}
                onChange={(e) => setSellerRemark(e.target.value)}
                placeholder="Note for factory"
                className="h-9"
              />
            </div>
          </div>

          {/* Item rows */}
          <div className="border rounded-lg divide-y">
            {forms.map((f) => {
              const item = items.find((i) => i.id === f.orderItemId)!;
              const isBlank = item.itemType === "other";
              return (
                <div key={f.orderItemId} className="p-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={f.selected}
                      onCheckedChange={(v) => updateForm(f.orderItemId, { selected: !!v })}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{item.title}</span>
                        {isBlank ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                            Blank
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                            {item.itemType}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">× {item.quantity}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {item.variantTitle && <span>{item.variantTitle} · </span>}
                        <span>Our SKU: {item.sku || "—"}</span>
                      </div>
                    </div>
                  </div>

                  {f.selected && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pl-7">
                      <div className="col-span-2">
                        <label className="text-[11px] text-muted-foreground">Factory SKU *</label>
                        <Input
                          value={f.factorySku}
                          onChange={(e) =>
                            updateForm(f.orderItemId, { factorySku: e.target.value })
                          }
                          placeholder="e.g. FXYA000797DG001BL"
                          className="h-8 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">Size</label>
                        <Input
                          value={f.sizeCode}
                          onChange={(e) =>
                            updateForm(f.orderItemId, { sizeCode: e.target.value })
                          }
                          placeholder="XL"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">Color</label>
                        <Input
                          value={f.colorCode}
                          onChange={(e) =>
                            updateForm(f.orderItemId, { colorCode: e.target.value })
                          }
                          placeholder="BL01"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-[11px] text-muted-foreground">Style (款号)</label>
                        <Input
                          value={f.styleCode}
                          onChange={(e) =>
                            updateForm(f.orderItemId, { styleCode: e.target.value })
                          }
                          placeholder="DG001 (defaults to factory SKU)"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-[11px] text-muted-foreground">Craft type</label>
                        <Select
                          value={f.craftType ? String(f.craftType) : "default"}
                          onValueChange={(v) =>
                            updateForm(f.orderItemId, {
                              craftType: v === "default" ? null : (Number(v) as 1 | 2),
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Use default</SelectItem>
                            <SelectItem value="1">白墨烫画</SelectItem>
                            <SelectItem value="2">白墨直喷</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Print toggle */}
                      <div className="md:col-span-4 flex items-center gap-2 pt-1 border-t">
                        <Checkbox
                          checked={f.shouldPrint}
                          onCheckedChange={(v) =>
                            updateForm(f.orderItemId, { shouldPrint: !!v })
                          }
                        />
                        <span className="text-xs">Print this item (打印)</span>
                      </div>

                      {f.shouldPrint ? (
                        <>
                          <div className="md:col-span-2">
                            <label className="text-[11px] text-muted-foreground">Print position</label>
                            <Select
                              value={f.printPosition}
                              onValueChange={(v) =>
                                updateForm(f.orderItemId, {
                                  printPosition: v as "1" | "2" | "1,2",
                                })
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
                              Image URLs (逗号分隔)
                            </label>
                            <Input
                              value={f.imageUrlsText}
                              onChange={(e) =>
                                updateForm(f.orderItemId, { imageUrlsText: e.target.value })
                              }
                              placeholder="https://..., https://..."
                              className="h-8 text-sm"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="md:col-span-4">
                          <label className="text-[11px] text-muted-foreground">
                            效果图 URLs (最多2张，逗号分隔) *
                          </label>
                          <Input
                            value={f.effectImageUrlsText}
                            onChange={(e) =>
                              updateForm(f.orderItemId, { effectImageUrlsText: e.target.value })
                            }
                            placeholder="https://xxx.com/image.jpg"
                            className="h-8 text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            不打印模式：需提供效果图，工厂将以成品直接发货
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Button className="w-full" onClick={handlePush} disabled={pushing}>
            {pushing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Pushing…
              </>
            ) : (
              <>
                <Factory className="h-4 w-4 mr-2" />
                Push to Factory
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
