"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
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
import { SupplierOrderLink } from "./supplier-order-link";
import { CatalogPicker } from "./catalog-picker";
import {
  useBlanksData,
  usePushBlanks,
  type BlanksConsignee,
  type BlanksItem,
  type BlanksGroupResult,
  type PushBlanksItemPayload,
} from "./use-push-blanks";

// THE push dialog — order list, order detail and the blanks page all open
// this same component; it only needs an orderId and fetches its own data.

interface ItemFormState {
  orderItemId: string;
  selected: boolean;
  supplierId: string; // "" = unassigned (vendor unmapped, needs manual pick)
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

const SIZE_TOKENS = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XL", "3XL", "4XL", "5XL", "ONESIZE", "OS"];

// Space-insensitive so "One Size" counts as a size token, not a color
function isSizeToken(part: string): boolean {
  return SIZE_TOKENS.includes(part.toUpperCase().replace(/\s+/g, ""));
}

function parseSizeFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  const parts = variantTitle.split("/").map((p) => p.trim());
  return parts.find((p) => isSizeToken(p)) || "";
}

function parseColorFromVariant(variantTitle: string | null): string {
  if (!variantTitle) return "";
  const parts = variantTitle.split("/").map((p) => p.trim());
  return parts.find((p) => !isSizeToken(p)) || "";
}

/** Our SKUs follow 款号-颜色-尺码 (T1-White-onesize) — fall back to the SKU
 * segments when the variant title parses nothing. */
function parseSkuParts(sku: string | null): { color: string; size: string } {
  const parts = (sku ?? "").split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { color: "", size: "" };
  return { color: parts.slice(1, -1).join("-"), size: parts[parts.length - 1] };
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
  const t = useTranslations("blanks");
  const { data, isLoading, mutate } = useBlanksData(orderId, open);
  const { busy, pushBlanks, rePush, refreshStatus } = usePushBlanks();
  const [sellerRemark, setSellerRemark] = useState("");
  const [forms, setForms] = useState<Record<string, ItemFormState>>({});
  const [results, setResults] = useState<BlanksGroupResult[] | null>(null);
  const [pendingAction, setPendingAction] = useState<"place" | "place_and_push" | null>(null);
  const [consignee, setConsignee] = useState<BlanksConsignee | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset per-open state so a reopen prefills fresh data
      setConsignee(null);
      setAddressOpen(false);
      return;
    }
    if (!data) return;
    setResults(null);
    // Prefill the editable consignee once per dialog open; auto-expand when
    // required fields are missing so the operator sees what to fix.
    setConsignee((prev) => prev ?? data.consignee);
    if (data.consigneeMissing.length > 0) setAddressOpen(true);
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
          supplierId: item.supplier?.id ?? "",
          factorySku: item.prefill?.factorySku ?? item.sku ?? "",
          sizeCode: item.prefill?.factorySize ?? (parseSizeFromVariant(item.variantTitle) || parseSkuParts(item.sku).size),
          colorCode: item.prefill?.factoryColor ?? (parseColorFromVariant(item.variantTitle) || parseSkuParts(item.sku).color),
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

  // Groups follow the form's (possibly overridden) supplier choice, not the
  // vendor mapping — switching an item's supplier moves it between groups.
  const groups = useMemo(() => {
    if (!data) return [];
    const supplierById = new Map(data.suppliers.map((s) => [s.id, s]));
    const bySupplier = new Map<string, { key: string; name: string; adapterType: string; items: BlanksItem[] }>();
    for (const item of data.items) {
      const supplierId = forms[item.id]?.supplierId || item.supplier?.id;
      if (!supplierId) continue;
      const s = supplierById.get(supplierId);
      if (!s) continue;
      const g = bySupplier.get(s.id) ?? {
        key: s.key,
        name: s.name,
        adapterType: s.adapterType,
        items: [],
      };
      g.items.push(item);
      bySupplier.set(s.id, g);
    }
    return [...bySupplier.entries()].map(([id, g]) => ({ supplierId: id, ...g }));
  }, [data, forms]);

  // Unassigned = no vendor route AND no manual supplier pick yet
  const unroutable = useMemo(
    () => (data?.items ?? []).filter((i) => i.unroutableReason && !forms[i.id]?.supplierId),
    [data, forms]
  );

  function updateForm(id: string, patch: Partial<ItemFormState>) {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  /** Switch an item to another supplier and re-prefill from that supplier's
   * SKU mapping (falling back to variant parsing when it has none). */
  function switchSupplier(item: BlanksItem, supplierId: string) {
    const p = item.prefills[supplierId];
    updateForm(item.id, {
      supplierId,
      selected: forms[item.id]?.selected || !item.supplierOrderNo,
      // No mapping at the target supplier -> clear the code instead of
      // carrying the previous supplier's; the catalog auto-match (or the
      // operator) fills it for the new supplier.
      factorySku: p?.factorySku ?? "",
      sizeCode: p?.factorySize ?? (parseSizeFromVariant(item.variantTitle) || parseSkuParts(item.sku).size),
      colorCode: p?.factoryColor ?? (parseColorFromVariant(item.variantTitle) || parseSkuParts(item.sku).color),
      styleCode: p?.factoryStyle ?? "",
      craftType: (p?.factoryCraftType as 1 | 2 | null) ?? 1,
    });
  }

  function buildPayload(): PushBlanksItemPayload[] | null {
    const selected = Object.values(forms).filter((f) => f.selected);
    if (selected.length === 0) {
      toast.error(t("selectAtLeastOne"));
      return null;
    }
    for (const f of selected) {
      if (!f.factorySku.trim()) {
        toast.error(t("needFactorySku"));
        return null;
      }
      // Both factory protocols require size and color on every goods item —
      // catch it here with the item named, instead of a group-level 400.
      const itemTitle = data?.items.find((i) => i.id === f.orderItemId)?.title ?? f.factorySku;
      if (!f.sizeCode.trim()) {
        toast.error(t("needSize", { title: itemTitle }));
        return null;
      }
      if (!f.colorCode.trim()) {
        toast.error(t("needColor", { title: itemTitle }));
        return null;
      }
      if (f.shouldPrint && splitUrls(f.imageUrlsText).length === 0) {
        toast.error(t("needPrintImage"));
        return null;
      }
    }
    return selected.map((f) => ({
      orderItemId: f.orderItemId,
      supplierId: f.supplierId || undefined,
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

  // Re-place mode: any selected item that already has a supplier order means
  // the group will be placed again under a sequential order number.
  const isReplacing = useMemo(() => {
    if (!data) return false;
    return data.items.some((item) => item.supplierOrderNo && forms[item.id]?.selected);
  }, [data, forms]);

  const consigneeMissing = useMemo(() => {
    if (!consignee) return [];
    return (["name", "phone", "address", "city", "province", "country"] as const).filter(
      (k) => !consignee[k]?.trim()
    );
  }, [consignee]);

  function updateConsignee(patch: Partial<BlanksConsignee>) {
    setConsignee((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handlePush(mode: "place" | "place_and_push") {
    if (consigneeMissing.length > 0) {
      setAddressOpen(true);
      toast.error(t("consigneeMissing", { fields: consigneeMissing.join(", ") }));
      return;
    }
    const items = buildPayload();
    if (!items) return;
    setPendingAction(mode);
    const res = await pushBlanks(orderId, mode, items, sellerRemark, isReplacing, consignee ?? undefined);
    setPendingAction(null);
    if (!res) return;
    setResults(res.results);
    const failed = res.results.filter((r) => r.status === "failed");
    if (failed.length === 0) {
      toast.success(mode === "place" ? t("toastPlaced") : t("toastPlacedPushed"));
      onSuccess?.();
      onOpenChange(false);
    } else {
      // Keep the dialog open so per-group errors are visible
      toast.error(
        failed.map((r) => `${r.supplierName}: ${r.error ?? t("resultPlacedPushFailed", { error: "" })}`).join("\n"),
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
            {t("dialogTitle")} {data?.orderNumber ? `· #${data.orderNumber}` : ""}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("dialogDescription")}
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
                  <span className="text-xs font-medium">{t("existingPushes")}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={handleRefreshStatus}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    {t("refreshStatus")}
                  </Button>
                </div>
                {data.pushes.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="font-medium">{p.supplierName}</span>
                    <SupplierOrderLink platformOid={p.platformOid} consoleUrl={p.supplierConsoleUrl} />
                    <SupplierPushStatusBadge push={p} />
                    {!p.pushedAt &&
                      (p.supplierAdapterType === "linmiao" ? (
                        <span className="text-amber-700">
                          {t("linmiaoAwaitingLabel")}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2"
                          disabled={busy}
                          onClick={() => handleRePush(p.id)}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          {t("pushToFactory")}
                        </Button>
                      ))}
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
                  {t("unroutableTitle")}
                </div>
                {unroutable.map((item) => (
                  <div key={item.id} className="text-amber-800 flex items-center gap-2 flex-wrap">
                    <span>
                      · {item.title} —{" "}
                      {item.unroutableReason === "no_vendor"
                        ? t("noVendor")
                        : t("vendorUnmapped", { vendor: item.vendor ?? "" })}
                    </span>
                    <Select
                      value=""
                      items={(data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
                      onValueChange={(v) => v && switchSupplier(item, v)}
                    >
                      <SelectTrigger className="h-6 text-[11px] w-36 bg-white">
                        <SelectValue placeholder={t("selectSupplier")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(data?.suppliers ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Link href="/blanks/settings" className="text-amber-900 underline">
                  {t("goConfigure")}
                </Link>
              </div>
            )}

            {/* Shipping address (editable — pushed orders use these values) */}
            {consignee && (
              <div
                className={
                  consigneeMissing.length > 0
                    ? "border border-red-300 bg-red-50/50 rounded-lg"
                    : "border rounded-lg"
                }
              >
                <button
                  type="button"
                  className="w-full px-3 py-2 flex items-center justify-between text-xs"
                  onClick={() => setAddressOpen((v) => !v)}
                >
                  <span className="font-medium flex items-center gap-1.5">
                    {t("shippingAddress")}
                    {consigneeMissing.length > 0 && (
                      <span className="text-red-600 font-normal">
                        {t("consigneeMissing", { fields: consigneeMissing.join(", ") })}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {addressOpen
                      ? "▲"
                      : `${consignee.name} · ${consignee.address} ${consignee.city} ▼`}
                  </span>
                </button>
                {addressOpen && (
                  <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                    {(
                      [
                        ["name", true],
                        ["phone", true],
                        ["address", true],
                        ["addressOptional", false],
                        ["city", true],
                        ["province", true],
                        ["country", true],
                        ["postCode", false],
                      ] as const
                    ).map(([field, required]) => (
                      <div key={field} className={field === "address" ? "col-span-2" : ""}>
                        <label className="text-[11px] text-muted-foreground">
                          {t(`addr_${field}`)}
                          {required ? " *" : ""}
                        </label>
                        <Input
                          value={consignee[field]}
                          onChange={(e) => updateConsignee({ [field]: e.target.value })}
                          className={
                            required && !consignee[field]?.trim()
                              ? "h-8 text-sm border-red-400"
                              : "h-8 text-sm"
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Seller remark */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {t("sellerRemark")}
              </label>
              <Input
                value={sellerRemark}
                onChange={(e) => setSellerRemark(e.target.value)}
                placeholder={t("remarkPlaceholder")}
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
                      {t("itemCount", { count: group.items.length })}
                    </span>
                    {group.adapterType === "linmiao" && (
                      <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        {t("linmiaoGroupNote")}
                      </span>
                    )}
                    {groupResult && (
                      <span
                        className={
                          groupResult.status === "failed"
                            ? "text-xs text-red-600"
                            : "text-xs text-green-600"
                        }
                      >
                        {groupResult.status === "pushed" && t("resultPushed")}
                        {groupResult.status === "placed" &&
                          (groupResult.pushError
                            ? t("resultPlacedPushFailed", { error: groupResult.pushError })
                            : t("resultPlaced"))}
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
                                    {t("alreadyPlacedBadge", { oid: item.supplierOrderNo ?? "" })}
                                  </span>
                                )}
                                {/* Alternate-supplier switch: moves the item to
                                    another group and re-prefills its mapping */}
                                {(data?.suppliers?.length ?? 0) > 1 && (
                                  <Select
                                    value={f.supplierId}
                                    items={(data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
                                    onValueChange={(v) => v && v !== f.supplierId && switchSupplier(item, v)}
                                  >
                                    <SelectTrigger className="h-6 text-[11px] w-32">
                                      <SelectValue placeholder={t("selectSupplier")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(data?.suppliers ?? []).map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.name}
                                          {item.supplier?.id === s.id ? ` ${t("defaultSupplier")}` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {item.variantTitle && <span>{item.variantTitle} · </span>}
                                <span>{t("ourSku")} {item.sku || "—"}</span>
                              </div>
                            </div>
                          </div>

                          {f.selected && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pl-7">
                              {f.supplierId && (
                                <CatalogPicker
                                  supplierId={f.supplierId}
                                  styleCode={f.styleCode}
                                  colorCode={f.colorCode}
                                  sizeCode={f.sizeCode}
                                  factorySku={f.factorySku}
                                  onPick={(patch) => updateForm(item.id, patch)}
                                />
                              )}
                              <div className="col-span-2">
                                <label className="text-[11px] text-muted-foreground">{t("factorySku")}</label>
                                <Input
                                  value={f.factorySku}
                                  onChange={(e) => updateForm(item.id, { factorySku: e.target.value })}
                                  className="h-8 text-sm font-mono"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground">{t("size")}</label>
                                <Input
                                  value={f.sizeCode}
                                  onChange={(e) => updateForm(item.id, { sizeCode: e.target.value })}
                                  placeholder="XL"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] text-muted-foreground">{t("color")}</label>
                                <Input
                                  value={f.colorCode}
                                  onChange={(e) => updateForm(item.id, { colorCode: e.target.value })}
                                  placeholder="BL01"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[11px] text-muted-foreground">{t("style")}</label>
                                <Input
                                  value={f.styleCode}
                                  onChange={(e) => updateForm(item.id, { styleCode: e.target.value })}
                                  placeholder={t("stylePlaceholder")}
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-[11px] text-muted-foreground">{t("craft")}</label>
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
                                    <SelectItem value="1">{t("craftHeat")}</SelectItem>
                                    <SelectItem value="2">{t("craftDtg")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="md:col-span-4 flex items-center gap-2 pt-1 border-t">
                                <Checkbox
                                  checked={f.shouldPrint}
                                  onCheckedChange={(v) => updateForm(item.id, { shouldPrint: !!v })}
                                />
                                <span className="text-xs">{t("printToggle")}</span>
                              </div>

                              {f.shouldPrint ? (
                                <>
                                  <div className="md:col-span-2">
                                    <label className="text-[11px] text-muted-foreground">{t("printPosition")}</label>
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
                                        <SelectItem value="1">{t("posFront")}</SelectItem>
                                        <SelectItem value="2">{t("posBack")}</SelectItem>
                                        <SelectItem value="1,2">{t("posBoth")}</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="text-[11px] text-muted-foreground">
                                      {t("printImages")}
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
                                    {t("effectImages")}
                                  </label>
                                  <Input
                                    value={f.effectImageUrlsText}
                                    onChange={(e) =>
                                      updateForm(item.id, { effectImageUrlsText: e.target.value })
                                    }
                                    placeholder={t("effectPlaceholder")}
                                    className="h-8 text-sm"
                                  />
                                  <p className="text-[10px] text-muted-foreground mt-1">
                                    {t("effectHint")}
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
                {t("noBlanks")}
              </p>
            )}

            {/* Actions: place only vs place + push */}
            {isReplacing && (
              <div className="border border-amber-300 bg-amber-50 rounded-lg p-2.5 text-xs text-amber-800">
                {t("replaceNotice")}
              </div>
            )}
            {groups.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => handlePush("place")} disabled={busy}>
                  {pendingAction === "place" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Factory className="h-4 w-4 mr-2" />
                  )}
                  {t("place")}
                </Button>
                <Button variant="outline" onClick={() => handlePush("place_and_push")} disabled={busy}>
                  {pendingAction === "place_and_push" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {t("placeAndPush")}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
