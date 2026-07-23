"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Package, Pencil, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GiftImportAddress } from "@/lib/gift-orders/customer-import";

export type GiftOmsSegment = {
  id: string;
  name: string;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type GiftOmsOrder = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: GiftImportAddress;
};

type PackageInfo = {
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

type PackageForm = {
  weightLbs: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
};

type Estimate = {
  productCode: string;
  productName: string;
  productNameLang2?: string;
  totalPrice: number;
  currencyCode: string;
  effectiveTime: string;
  chargedWeight: number;
  remoteFlag: boolean;
};

type OrderQuote = {
  orderId: string;
  success: boolean;
  estimates?: Estimate[];
  error?: string;
};

function packageForm(segment: GiftOmsSegment): PackageForm {
  return {
    weightLbs: String(segment.weightLbs),
    lengthIn: String(segment.lengthIn),
    widthIn: String(segment.widthIn),
    heightIn: String(segment.heightIn),
  };
}

function parsedPackage(values: PackageForm): PackageInfo | null {
  const result = {
    weightLbs: Number(values.weightLbs),
    lengthIn: Number(values.lengthIn),
    widthIn: Number(values.widthIn),
    heightIn: Number(values.heightIn),
  };
  return Object.values(result).every(
    (value) => Number.isFinite(value) && value > 0
  )
    ? result
    : null;
}

function addressLine(address: GiftImportAddress) {
  return [
    address.address1,
    address.address2,
    address.city,
    address.province_code,
    address.zip,
    address.country_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function PackageFields({
  values,
  onChange,
  disabled = false,
}: {
  values: PackageForm;
  onChange: (values: PackageForm) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("giftOrders");
  const fields = [
    ["weightLbs", t("fields.weight")],
    ["lengthIn", t("fields.length")],
    ["widthIn", t("fields.width")],
    ["heightIn", t("fields.height")],
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {fields.map(([field, label]) => (
        <div key={field} className="space-y-1.5">
          <Label htmlFor={`gift-package-${field}`}>{label}</Label>
          <Input
            id={`gift-package-${field}`}
            type="number"
            min="0.01"
            step="0.01"
            required
            disabled={disabled}
            value={values[field]}
            onChange={(event) =>
              onChange({ ...values, [field]: event.target.value })
            }
          />
        </div>
      ))}
    </div>
  );
}

export function GiftPackageEditDialog({
  segment,
  open,
  onOpenChange,
  onSuccess,
}: {
  segment: GiftOmsSegment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("giftOrders");
  const [values, setValues] = useState(() => packageForm(segment));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValues(packageForm(segment));
  }, [open, segment]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const packageInfo = parsedPackage(values);
    if (!packageInfo) {
      toast.error(t("packageInvalid"));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/gift-segments/${segment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packageInfo),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || t("packageSaveFailed"));
      }
      toast.success(t("packageSaved"));
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("packageSaveFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("editPackage")}
            </DialogTitle>
            <DialogDescription>
              {t("editPackageDescription", { segment: segment.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5">
            <PackageFields
              values={values}
              onChange={setValues}
              disabled={saving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {t("savePackage")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GiftOmsPushDialog({
  segment,
  orders,
  open,
  onOpenChange,
  onSuccess,
}: {
  segment: GiftOmsSegment;
  orders: GiftOmsOrder[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("giftOrders");
  const [step, setStep] = useState<"package" | "quotes">("package");
  const [values, setValues] = useState(() => packageForm(segment));
  const [quoting, setQuoting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [quotes, setQuotes] = useState<OrderQuote[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<
    Record<string, string>
  >({});
  const orderById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders]
  );

  useEffect(() => {
    if (!open) return;
    setStep("package");
    setValues(packageForm(segment));
    setQuotes([]);
    setSelectedProducts({});
  }, [open, segment]);

  const quotedOrders = quotes.filter(
    (quote) =>
      quote.success &&
      quote.estimates?.length &&
      selectedProducts[quote.orderId]
  );
  const total = quotedOrders.reduce((sum, quote) => {
    const estimate = quote.estimates?.find(
      (item) => item.productCode === selectedProducts[quote.orderId]
    );
    return sum + (estimate?.totalPrice ?? 0);
  }, 0);

  async function getQuotes() {
    const packageInfo = parsedPackage(values);
    if (!packageInfo) {
      toast.error(t("packageInvalid"));
      return;
    }
    if (!orders.length) return;

    setQuoting(true);
    try {
      const response = await fetch(
        `/api/gift-segments/${segment.id}/estimate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: orders.map((order) => order.id),
            packageInfo,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || t("quoteFailed"));
      }
      const nextQuotes = result.quotes as OrderQuote[];
      const nextProducts: Record<string, string> = {};
      for (const quote of nextQuotes) {
        const cheapest = quote.estimates?.[0];
        if (quote.success && cheapest) {
          nextProducts[quote.orderId] = cheapest.productCode;
        }
      }
      setQuotes(nextQuotes);
      setSelectedProducts(nextProducts);
      setStep("quotes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("quoteFailed"));
    } finally {
      setQuoting(false);
    }
  }

  async function pushOrders() {
    const packageInfo = parsedPackage(values);
    if (!packageInfo || !quotedOrders.length) return;

    setPushing(true);
    try {
      const response = await fetch(`/api/gift-segments/${segment.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageInfo,
          savePackageInfo: true,
          orders: quotedOrders.map((quote) => ({
            orderId: quote.orderId,
            productCode: selectedProducts[quote.orderId],
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || t("pushFailed"));
      }
      if (result.failed) {
        toast.warning(
          t("pushPartial", { pushed: result.pushed, failed: result.failed })
        );
      } else {
        toast.success(t("pushSuccess", { count: result.pushed }));
      }
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("pushFailed"));
    } finally {
      setPushing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pushing) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t("pushSelectedTitle", { count: orders.length })}
          </DialogTitle>
          <DialogDescription>
            {step === "package"
              ? t("pushPackageDescription")
              : t("quoteReviewDescription")}
          </DialogDescription>
        </DialogHeader>

        {step === "package" ? (
          <div className="space-y-5">
            <section className="space-y-3 rounded-lg border p-4">
              <div>
                <h3 className="font-medium">{t("packageInformation")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("packageChangeHint")}
                </p>
              </div>
              <PackageFields values={values} onChange={setValues} />
            </section>

            <section className="overflow-hidden rounded-lg border">
              <div className="border-b bg-muted/40 px-4 py-3">
                <h3 className="font-medium">
                  {t("selectedRecipients", { count: orders.length })}
                </h3>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.customer")}</TableHead>
                      <TableHead>{t("columns.address")}</TableHead>
                      <TableHead>{t("contact")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          {order.customerName}
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal">
                          {addressLine(order.shippingAddress)}
                        </TableCell>
                        <TableCell>
                          {order.customerEmail ||
                            order.customerPhone ||
                            "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4" />
                <span>
                  {values.weightLbs} lb · {values.lengthIn} × {values.widthIn} ×{" "}
                  {values.heightIn} in
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("package")}
                disabled={pushing}
              >
                <Pencil />
                {t("editAndRequote")}
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.customer")}</TableHead>
                    <TableHead>{t("columns.address")}</TableHead>
                    <TableHead>{t("shippingService")}</TableHead>
                    <TableHead className="text-right">
                      {t("quote")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.map((quote) => {
                    const order = orderById.get(quote.orderId);
                    if (!order) return null;
                    const selectedCode = selectedProducts[quote.orderId];
                    const selectedEstimate = quote.estimates?.find(
                      (estimate) => estimate.productCode === selectedCode
                    );
                    return (
                      <TableRow key={quote.orderId}>
                        <TableCell>
                          <div className="font-medium">
                            {order.customerName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {order.customerEmail || order.customerPhone || "—"}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-normal">
                          {addressLine(order.shippingAddress)}
                        </TableCell>
                        <TableCell>
                          {quote.success && quote.estimates?.length ? (
                            <select
                              className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm"
                              value={selectedCode}
                              disabled={pushing}
                              onChange={(event) =>
                                setSelectedProducts((current) => ({
                                  ...current,
                                  [quote.orderId]: event.target.value,
                                }))
                              }
                            >
                              {quote.estimates.map((estimate, index) => (
                                <option
                                  key={estimate.productCode}
                                  value={estimate.productCode}
                                >
                                  {estimate.productName} · $
                                  {estimate.totalPrice.toFixed(2)}
                                  {index === 0 ? ` · ${t("cheapest")}` : ""}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="flex max-w-xs gap-2 text-xs text-destructive">
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                              {quote.error || t("quoteFailed")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {selectedEstimate ? (
                            <>
                              ${selectedEstimate.totalPrice.toFixed(2)}
                              {selectedEstimate.remoteFlag && (
                                <Badge
                                  variant="destructive"
                                  className="ml-2"
                                >
                                  {t("remote")}
                                </Badge>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-4">
              <div className="text-sm text-muted-foreground">
                {t("quoteSummary", {
                  ready: quotedOrders.length,
                  failed: quotes.length - quotedOrders.length,
                })}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">
                  {t("estimatedTotal")}
                </div>
                <div className="text-xl font-semibold">${total.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              step === "quotes" ? setStep("package") : onOpenChange(false)
            }
            disabled={quoting || pushing}
          >
            {step === "quotes" ? t("back") : t("cancel")}
          </Button>
          {step === "package" ? (
            <Button onClick={getQuotes} disabled={quoting || !orders.length}>
              {quoting && <Loader2 className="animate-spin" />}
              {quoting
                ? t("quoting")
                : t("getQuotes", { count: orders.length })}
            </Button>
          ) : (
            <Button
              onClick={pushOrders}
              disabled={pushing || !quotedOrders.length}
            >
              {pushing && <Loader2 className="animate-spin" />}
              {pushing
                ? t("pushing")
                : t("confirmPushSelected", { count: quotedOrders.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
