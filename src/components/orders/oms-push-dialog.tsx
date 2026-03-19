"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Package, Truck, Plus, Trash2, Check, MapPin } from "lucide-react";
import { toast } from "sonner";

interface PackagePreset {
  id: string;
  name: string;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  isDefault: boolean;
}

interface EstimateResult {
  productCode: string;
  productName: string;
  productNameLang2?: string;
  totalPrice: number;
  currencyCode: string;
  effectiveTime: string;
  chargedWeight: number;
  remoteFlag: boolean;
  feeList: { expenseType_dictText: string; expenseAmount: number; currencyCode: string }[];
}

interface PackageInfo {
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

interface ShippingAddr {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  city: string;
  province_code: string;
  zip: string;
  country_code: string;
  phone: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function OmsPushDialog({
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
  const t = useTranslations("oms");

  // Package presets
  const { data: presets, mutate: mutatePresets } = useSWR<PackagePreset[]>(
    open ? "/api/package-presets" : null,
    fetcher
  );

  // Fetch order for shipping address
  const { data: orderData } = useSWR(
    open && orderId ? `/api/orders/${orderId}` : null,
    fetcher
  );

  // State
  const [step, setStep] = useState<"package" | "estimate" | "pushing">("package");
  const [addr, setAddr] = useState<ShippingAddr>({
    first_name: "", last_name: "", address1: "", address2: "",
    city: "", province_code: "", zip: "", country_code: "US", phone: "",
  });
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [pkg, setPkg] = useState<PackageInfo>({ weightLbs: 1, lengthIn: 10, widthIn: 8, heightIn: 2 });
  const [estimates, setEstimates] = useState<EstimateResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [pushing, setPushing] = useState(false);

  // New preset form
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPreset, setNewPreset] = useState({ name: "", weightLbs: 1, lengthIn: 10, widthIn: 8, heightIn: 2 });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep("package");
      setSelectedPreset(null);
      setManualMode(false);
      setEstimates([]);
      setSelectedProduct(null);
      setShowAddPreset(false);
      // Auto-select default preset
      if (presets?.length) {
        const defaultPreset = presets.find((p) => p.isDefault) || presets[0];
        setSelectedPreset(defaultPreset.id);
        setPkg({
          weightLbs: defaultPreset.weightLbs,
          lengthIn: defaultPreset.lengthIn,
          widthIn: defaultPreset.widthIn,
          heightIn: defaultPreset.heightIn,
        });
      }
    }
  }, [open, presets]);

  // Populate address from order data
  useEffect(() => {
    if (orderData?.shippingAddress) {
      const a = orderData.shippingAddress;
      setAddr({
        first_name: a.first_name || "",
        last_name: a.last_name || "",
        address1: a.address1 || "",
        address2: a.address2 || "",
        city: a.city || "",
        province_code: a.province_code || a.province || "",
        zip: a.zip || "",
        country_code: a.country_code || "US",
        phone: a.phone || "",
      });
    }
  }, [orderData]);

  function selectPreset(preset: PackagePreset) {
    setSelectedPreset(preset.id);
    setManualMode(false);
    setPkg({
      weightLbs: preset.weightLbs,
      lengthIn: preset.lengthIn,
      widthIn: preset.widthIn,
      heightIn: preset.heightIn,
    });
  }

  async function handleEstimate() {
    setEstimating(true);
    try {
      const res = await fetch("/api/oms/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, packageInfo: pkg, addressOverride: addr }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Estimate failed");
      }
      const data = await res.json();
      setEstimates(data);
      setStep("estimate");
      // Auto-select cheapest
      if (data.length > 0) {
        setSelectedProduct(data[0].productCode);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Estimate failed");
    } finally {
      setEstimating(false);
    }
  }

  async function handlePush() {
    if (!selectedProduct) return;
    setPushing(true);
    setStep("pushing");
    try {
      const res = await fetch("/api/oms/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, productCode: selectedProduct, packageInfo: pkg, addressOverride: addr }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Push failed");
      }
      const data = await res.json();
      const parts = [t("pushSuccess")];
      if (data.omsOrder.serverNo) parts.push(data.omsOrder.serverNo);
      if (data.omsOrder.productName) parts.push(data.omsOrder.productName);
      if (data.omsOrder.totalPrice != null) parts.push(`$${data.omsOrder.totalPrice}`);
      toast.success(parts.join(" | "));
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("pushFailed"));
      setStep("estimate");
    } finally {
      setPushing(false);
    }
  }

  async function addPreset() {
    if (!newPreset.name) return;
    try {
      const res = await fetch("/api/package-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPreset),
      });
      if (res.ok) {
        mutatePresets();
        setShowAddPreset(false);
        setNewPreset({ name: "", weightLbs: 1, lengthIn: 10, widthIn: 8, heightIn: 2 });
      }
    } catch {
      toast.error("Failed to add preset");
    }
  }

  async function deletePreset(id: string) {
    try {
      await fetch(`/api/package-presets?id=${id}`, { method: "DELETE" });
      mutatePresets();
      if (selectedPreset === id) {
        setSelectedPreset(null);
      }
    } catch {
      toast.error("Failed to delete preset");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t("pushToOms")}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {step === "package" && t("selectPackage")}
            {step === "estimate" && t("estimatedCost")}
            {step === "pushing" && t("pushing")}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Package Selection */}
        {step === "package" && (
          <div className="space-y-4">
            {/* Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t("selectPackage")}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddPreset(!showAddPreset)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("addPreset")}
                </Button>
              </div>

              {/* Add Preset Form */}
              {showAddPreset && (
                <div className="border rounded-lg p-3 space-y-2 bg-muted/50">
                  <Input
                    placeholder={t("presetName")}
                    value={newPreset.name}
                    onChange={(e) =>
                      setNewPreset({ ...newPreset, name: e.target.value })
                    }
                  />
                  <div className="grid grid-cols-4 gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      placeholder={t("weight")}
                      value={newPreset.weightLbs}
                      onChange={(e) =>
                        setNewPreset({ ...newPreset, weightLbs: parseFloat(e.target.value) || 0 })
                      }
                    />
                    <Input
                      type="number"
                      step="0.1"
                      placeholder={t("length")}
                      value={newPreset.lengthIn}
                      onChange={(e) =>
                        setNewPreset({ ...newPreset, lengthIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                    <Input
                      type="number"
                      step="0.1"
                      placeholder={t("width")}
                      value={newPreset.widthIn}
                      onChange={(e) =>
                        setNewPreset({ ...newPreset, widthIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                    <Input
                      type="number"
                      step="0.1"
                      placeholder={t("height")}
                      value={newPreset.heightIn}
                      onChange={(e) =>
                        setNewPreset({ ...newPreset, heightIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={addPreset} disabled={!newPreset.name}>
                      {t("addPreset")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAddPreset(false)}>
                      {t("cancel") || "Cancel"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Preset List */}
              {presets && presets.length > 0 ? (
                <div className="grid gap-2">
                  {presets.map((preset) => (
                    <div
                      key={preset.id}
                      className={`flex items-center justify-between border rounded-lg p-3 cursor-pointer transition-colors ${
                        selectedPreset === preset.id && !manualMode
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => selectPreset(preset)}
                    >
                      <div className="flex items-center gap-3">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{preset.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {preset.weightLbs}lb | {preset.lengthIn}x{preset.widthIn}x{preset.heightIn} in
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {selectedPreset === preset.id && !manualMode && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePreset(preset.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noPresets")}</p>
              )}
            </div>

            {/* Manual Input */}
            <div className="space-y-2">
              <button
                className={`text-sm font-medium cursor-pointer ${
                  manualMode ? "text-primary" : "text-muted-foreground"
                }`}
                onClick={() => {
                  setManualMode(true);
                  setSelectedPreset(null);
                }}
              >
                {t("manualInput")}
              </button>
              {manualMode && (
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">{t("weight")}</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={pkg.weightLbs}
                      onChange={(e) =>
                        setPkg({ ...pkg, weightLbs: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("length")}</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={pkg.lengthIn}
                      onChange={(e) =>
                        setPkg({ ...pkg, lengthIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("width")}</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={pkg.widthIn}
                      onChange={(e) =>
                        setPkg({ ...pkg, widthIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("height")}</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={pkg.heightIn}
                      onChange={(e) =>
                        setPkg({ ...pkg, heightIn: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Shipping Address */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">Shipping Address</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">First Name</Label>
                  <Input
                    value={addr.first_name}
                    onChange={(e) => setAddr({ ...addr, first_name: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Last Name</Label>
                  <Input
                    value={addr.last_name}
                    onChange={(e) => setAddr({ ...addr, last_name: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Address 1</Label>
                <Input
                  value={addr.address1}
                  onChange={(e) => setAddr({ ...addr, address1: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Address 2</Label>
                <Input
                  value={addr.address2}
                  onChange={(e) => setAddr({ ...addr, address2: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">City</Label>
                  <Input
                    value={addr.city}
                    onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">State</Label>
                  <Input
                    value={addr.province_code}
                    onChange={(e) => setAddr({ ...addr, province_code: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">ZIP</Label>
                  <Input
                    value={addr.zip}
                    onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Country</Label>
                  <Input
                    value={addr.country_code}
                    onChange={(e) => setAddr({ ...addr, country_code: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Phone</Label>
                  <Input
                    value={addr.phone}
                    onChange={(e) => setAddr({ ...addr, phone: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              onClick={handleEstimate}
              disabled={estimating || pkg.weightLbs <= 0}
            >
              {estimating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("estimating")}
                </>
              ) : (
                t("estimateCost")
              )}
            </Button>
          </div>
        )}

        {/* Step 2: Estimate Results */}
        {step === "estimate" && (
          <div className="space-y-4">
            {/* Package & address summary */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                {pkg.weightLbs}lb | {pkg.lengthIn}x{pkg.widthIn}x{pkg.heightIn} in
              </div>
              <div>
                {[addr.first_name, addr.last_name].filter(Boolean).join(" ")}
                {addr.address1 && `, ${addr.address1}`}
                {addr.city && `, ${addr.city}`}
                {addr.province_code && ` ${addr.province_code}`}
                {addr.zip && ` ${addr.zip}`}
              </div>
              <button
                className="text-primary underline"
                onClick={() => setStep("package")}
              >
                Change
              </button>
            </div>

            {/* Results table */}
            {estimates.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t("product")}</th>
                      <th className="text-right px-3 py-2 font-medium">{t("cost")}</th>
                      <th className="text-right px-3 py-2 font-medium">{t("deliveryTime")}</th>
                      <th className="px-3 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimates.map((est, i) => (
                      <tr
                        key={est.productCode}
                        className={`border-t cursor-pointer transition-colors ${
                          selectedProduct === est.productCode
                            ? "bg-primary/5"
                            : "hover:bg-muted/30"
                        }`}
                        onClick={() => setSelectedProduct(est.productCode)}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{est.productName}</div>
                          {est.remoteFlag && (
                            <span className="text-xs text-orange-600">Remote</span>
                          )}
                          {i === 0 && (
                            <span className="ml-1 text-xs text-green-600 font-medium">
                              Cheapest
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          ${est.totalPrice.toFixed(2)}
                          <div className="text-xs text-muted-foreground">
                            {est.currencyCode}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {est.effectiveTime}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {selectedProduct === est.productCode ? (
                            <Check className="h-4 w-4 text-primary inline" />
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("select")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
            )}

            <Button
              className="w-full"
              onClick={handlePush}
              disabled={!selectedProduct || pushing}
            >
              {pushing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("pushing")}
                </>
              ) : (
                t("pushToOms")
              )}
            </Button>
          </div>
        )}

        {/* Step 3: Pushing */}
        {step === "pushing" && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("pushing")}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
