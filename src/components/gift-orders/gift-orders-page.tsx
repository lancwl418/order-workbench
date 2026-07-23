"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import {
  CircleAlert,
  FileSpreadsheet,
  Gift,
  Loader2,
  Package,
  Plus,
  Send,
  Truck,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import {
  missingGiftCustomerFields,
  parseGiftCustomers,
  type GiftImportAddress,
} from "@/lib/gift-orders/customer-import";
import { cn } from "@/lib/utils";

type GiftOrder = {
  id: string;
  customerExternalId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: GiftImportAddress;
  status: "READY" | "PUSHING" | "PUSHED" | "FAILED";
  errorMessage: string | null;
  omsOrderNo: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  service: string | null;
  shippingCost: string | number | null;
  pushedAt: string | null;
  createdAt: string;
};

type GiftSegment = {
  id: string;
  name: string;
  giftTitle: string;
  giftSku: string;
  giftQuantity: number;
  giftValue: number;
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  orders: GiftOrder[];
  _count: { orders: number };
};

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load gift segments");
  return response.json();
};

const initialSegmentForm = {
  name: "",
  giftTitle: "",
  giftSku: "",
  giftQuantity: "1",
  giftValue: "10",
  weightLbs: "1",
  lengthIn: "10",
  widthIn: "8",
  heightIn: "2",
};

function orderNumber(id: string) {
  return `GIFT-${id.slice(-12).toUpperCase()}`;
}

function statusVariant(status: GiftOrder["status"]) {
  if (status === "PUSHED") return "default" as const;
  if (status === "FAILED") return "destructive" as const;
  if (status === "PUSHING") return "secondary" as const;
  return "outline" as const;
}

function formatAddress(address: GiftImportAddress) {
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

export function GiftOrdersPage() {
  const t = useTranslations("giftOrders");
  const { data, error, isLoading, mutate } = useSWR<GiftSegment[]>(
    "/api/gift-segments",
    fetcher
  );
  const segments = useMemo(() => data ?? [], [data]);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [segmentForm, setSegmentForm] = useState(initialSegmentForm);
  const [customerData, setCustomerData] = useState("");
  const [customerFileName, setCustomerFileName] = useState("");

  useEffect(() => {
    if (!segments.length) {
      setSelectedId("");
      return;
    }
    if (!segments.some((segment) => segment.id === selectedId)) {
      setSelectedId(segments[0].id);
    }
  }, [segments, selectedId]);

  const selected =
    segments.find((segment) => segment.id === selectedId) ?? segments[0];
  const allOrders = segments.flatMap((segment) => segment.orders);
  const readyCount = allOrders.filter((order) => order.status === "READY").length;
  const pushedCount = allOrders.filter((order) => order.status === "PUSHED").length;
  const failedCount = allOrders.filter((order) => order.status === "FAILED").length;
  const pushableCount =
    selected?.orders.filter((order) => order.status !== "PUSHED").length ?? 0;
  const importPreview = useMemo(() => {
    if (!customerData.trim()) {
      return { customers: [], invalidRows: [] as number[], error: null };
    }
    try {
      const customers = parseGiftCustomers(customerData);
      const invalidRows = customers
        .map((customer, index) =>
          missingGiftCustomerFields(customer).length ? index : -1
        )
        .filter((index) => index >= 0);
      return { customers, invalidRows, error: null };
    } catch (previewError) {
      return {
        customers: [],
        invalidRows: [] as number[],
        error:
          previewError instanceof Error
            ? previewError.message
            : t("importFailed"),
      };
    }
  }, [customerData, t]);

  async function createSegment(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      const response = await fetch("/api/gift-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: segmentForm.name,
          giftTitle: segmentForm.giftTitle,
          giftSku: segmentForm.giftSku,
          giftQuantity: Number(segmentForm.giftQuantity),
          giftValue: Number(segmentForm.giftValue),
          weightLbs: Number(segmentForm.weightLbs),
          lengthIn: Number(segmentForm.lengthIn),
          widthIn: Number(segmentForm.widthIn),
          heightIn: Number(segmentForm.heightIn),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("createFailed"));
      await mutate();
      setSelectedId(result.id);
      setSegmentForm(initialSegmentForm);
      setCreateOpen(false);
      toast.success(t("createSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function importCustomers(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setImporting(true);
    try {
      if (importPreview.error) throw new Error(importPreview.error);
      const customers = importPreview.customers;
      if (!customers.length) throw new Error(t("noImportRows"));
      const invalidRow = importPreview.invalidRows[0] ?? -1;
      if (invalidRow >= 0) {
        throw new Error(t("invalidRow", { row: invalidRow + 2 }));
      }

      const response = await fetch(`/api/gift-segments/${selected.id}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customers }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("importFailed"));
      await mutate();
      setCustomerData("");
      setCustomerFileName("");
      setImportOpen(false);
      toast.success(
        t("importSuccess", { created: result.created, skipped: result.skipped })
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("importFailed"));
    } finally {
      setImporting(false);
    }
  }

  async function loadCustomerFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("fileTooLarge"));
      event.target.value = "";
      return;
    }

    try {
      const content = await file.text();
      setCustomerData(content);
      setCustomerFileName(file.name);
    } catch {
      toast.error(t("fileReadFailed"));
    }
  }

  async function pushSegment() {
    if (!selected || pushableCount === 0) return;
    if (!window.confirm(t("confirmPush", { count: pushableCount }))) return;

    setPushingId(selected.id);
    try {
      const response = await fetch(`/api/gift-segments/${selected.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("pushFailed"));
      await mutate();
      if (result.failed) {
        toast.warning(
          t("pushPartial", { pushed: result.pushed, failed: result.failed })
        );
      } else {
        toast.success(t("pushSuccess", { count: result.pushed }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("pushFailed"));
      await mutate();
    } finally {
      setPushingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 text-destructive">
          <CircleAlert className="h-5 w-5" />
          {t("loadFailed")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gift className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          {t("newSegment")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t("segments"), value: segments.length, icon: Users },
          { label: t("ready"), value: readyCount, icon: Package },
          { label: t("pushed"), value: pushedCount, icon: Truck },
          { label: t("failed"), value: failedCount, icon: CircleAlert },
        ].map((item) => (
          <Card key={item.label} size="sm">
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-2xl font-semibold">{item.value}</p>
              </div>
              <item.icon className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      {segments.length === 0 ? (
        <Card className="py-10">
          <CardContent className="flex flex-col items-center text-center">
            <Gift className="mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="font-medium">{t("emptyTitle")}</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {t("emptyDescription")}
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus />
              {t("newSegment")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {segments.map((segment) => {
              const failed = segment.orders.filter(
                (order) => order.status === "FAILED"
              ).length;
              return (
                <Button
                  key={segment.id}
                  variant={segment.id === selected?.id ? "default" : "outline"}
                  onClick={() => setSelectedId(segment.id)}
                >
                  {segment.name}
                  <Badge
                    variant={segment.id === selected?.id ? "secondary" : "outline"}
                  >
                    {segment._count.orders}
                  </Badge>
                  {failed > 0 && (
                    <Badge variant="destructive">{failed}</Badge>
                  )}
                </Button>
              );
            })}
          </div>

          {selected && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription>
                  {t("segmentSummary", {
                    gift: selected.giftTitle,
                    sku: selected.giftSku,
                    quantity: selected.giftQuantity,
                    weight: selected.weightLbs,
                    length: selected.lengthIn,
                    width: selected.widthIn,
                    height: selected.heightIn,
                  })}
                </CardDescription>
                <CardAction className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setImportOpen(true)}>
                    <Upload />
                    {t("importCustomers")}
                  </Button>
                  <Button
                    onClick={pushSegment}
                    disabled={pushableCount === 0 || pushingId === selected.id}
                  >
                    {pushingId === selected.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                    {pushingId === selected.id
                      ? t("pushing")
                      : t("pushAll", { count: pushableCount })}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="px-0">
                <div className="border-b px-4 py-3 text-xs text-muted-foreground">
                  {t("cheapestHint")}
                </div>
                {selected.orders.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-center">
                    <Users className="mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">{t("noCustomers")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("noCustomersHint")}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.order")}</TableHead>
                        <TableHead>{t("columns.customer")}</TableHead>
                        <TableHead>{t("columns.address")}</TableHead>
                        <TableHead>{t("columns.gift")}</TableHead>
                        <TableHead>{t("columns.status")}</TableHead>
                        <TableHead>{t("columns.shipping")}</TableHead>
                        <TableHead>{t("columns.tracking")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-xs">
                            {orderNumber(order.id)}
                            {order.customerExternalId && (
                              <span className="mt-0.5 block text-muted-foreground">
                                {order.customerExternalId}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{order.customerName}</div>
                            <div className="text-xs text-muted-foreground">
                              {order.customerEmail || order.customerPhone || "—"}
                            </div>
                          </TableCell>
                          <TableCell
                            className="max-w-72 truncate"
                            title={formatAddress(order.shippingAddress)}
                          >
                            {formatAddress(order.shippingAddress)}
                          </TableCell>
                          <TableCell>
                            {selected.giftTitle}
                            <span className="ml-1 text-muted-foreground">
                              ×{selected.giftQuantity}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {selected.giftSku}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(order.status)}>
                              {order.status === "PUSHING" && (
                                <Loader2 className="animate-spin" />
                              )}
                              {t(`status.${order.status}`)}
                            </Badge>
                            {order.errorMessage && (
                              <span
                                className="mt-1 block max-w-64 truncate text-xs text-destructive"
                                title={order.errorMessage}
                              >
                                {order.errorMessage}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.carrier || "—"}
                            {order.shippingCost != null && (
                              <span className="block text-xs text-muted-foreground">
                                ${Number(order.shippingCost).toFixed(2)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "font-mono text-xs",
                                !order.trackingNumber && "text-muted-foreground"
                              )}
                            >
                              {order.trackingNumber || order.omsOrderNo || "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={createSegment}>
            <DialogHeader>
              <DialogTitle>{t("createTitle")}</DialogTitle>
              <DialogDescription>{t("createDescription")}</DialogDescription>
            </DialogHeader>
            <div className="my-5 grid gap-4 sm:grid-cols-2">
              {[
                ["name", t("fields.segmentName"), "VIP Summer"],
                ["giftTitle", t("fields.giftTitle"), "Summer gift set"],
                ["giftSku", t("fields.giftSku"), "GIFT-SUMMER-01"],
                ["giftQuantity", t("fields.quantity"), "1"],
                ["giftValue", t("fields.value"), "10"],
                ["weightLbs", t("fields.weight"), "1"],
                ["lengthIn", t("fields.length"), "10"],
                ["widthIn", t("fields.width"), "8"],
                ["heightIn", t("fields.height"), "2"],
              ].map(([field, label, placeholder]) => (
                <div
                  key={field}
                  className={cn(
                    "space-y-1.5",
                    field === "name" && "sm:col-span-2"
                  )}
                >
                  <Label htmlFor={`gift-${field}`}>{label}</Label>
                  <Input
                    id={`gift-${field}`}
                    required
                    min={
                      [
                        "giftQuantity",
                        "weightLbs",
                        "lengthIn",
                        "widthIn",
                        "heightIn",
                      ].includes(field)
                        ? "0.01"
                        : undefined
                    }
                    step={field === "giftQuantity" ? "1" : "0.01"}
                    type={
                      [
                        "giftQuantity",
                        "giftValue",
                        "weightLbs",
                        "lengthIn",
                        "widthIn",
                        "heightIn",
                      ].includes(field)
                        ? "number"
                        : "text"
                    }
                    value={segmentForm[field as keyof typeof segmentForm]}
                    placeholder={placeholder}
                    onChange={(event) =>
                      setSegmentForm((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="animate-spin" />}
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <form onSubmit={importCustomers}>
            <DialogHeader>
              <DialogTitle>{t("importTitle")}</DialogTitle>
              <DialogDescription>{t("importDescription")}</DialogDescription>
            </DialogHeader>
            <div className="my-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gift-customer-file">
                  {t("uploadCustomerFile")}
                </Label>
                <label
                  htmlFor="gift-customer-file"
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 transition-colors hover:bg-muted/50"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileSpreadsheet className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {customerFileName || t("chooseCsv")}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("shopifyCsvHint")}
                    </span>
                  </span>
                  <span className="inline-flex h-7 items-center gap-1 rounded-lg border bg-background px-2.5 text-xs font-medium">
                    <Upload />
                    {t("browse")}
                  </span>
                </label>
                <Input
                  id="gift-customer-file"
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  className="sr-only"
                  onChange={loadCustomerFile}
                />
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("orPaste")}
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gift-customer-data">{t("customerData")}</Label>
              <Textarea
                id="gift-customer-data"
                  className="min-h-36 font-mono text-xs"
                value={customerData}
                  onChange={(event) => {
                    setCustomerData(event.target.value);
                    setCustomerFileName("");
                  }}
                placeholder={t("csvPlaceholder")}
              />
                <p className="text-xs text-muted-foreground">
                  {t("csvColumns")}
                </p>
              </div>

              {importPreview.error && (
                <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {importPreview.error}
                </div>
              )}

              {importPreview.customers.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <span className="font-medium">{t("preview")}</span>
                    <div className="flex gap-2">
                      <Badge variant="secondary">
                        {t("validRows", {
                          count:
                            importPreview.customers.length -
                            importPreview.invalidRows.length,
                        })}
                      </Badge>
                      {importPreview.invalidRows.length > 0 && (
                        <Badge variant="destructive">
                          {t("invalidRows", {
                            count: importPreview.invalidRows.length,
                          })}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("columns.customer")}</TableHead>
                        <TableHead>{t("columns.address")}</TableHead>
                        <TableHead>{t("previewStatus")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.customers
                        .slice(0, 5)
                        .map((customer, index) => {
                          const missing = missingGiftCustomerFields(customer);
                          const address = customer.shippingAddress;
                          const name =
                            customer.customerName ||
                            `${address.first_name || ""} ${
                              address.last_name || ""
                            }`.trim();
                          return (
                            <TableRow key={customer.customerExternalId || index}>
                              <TableCell>
                                <div className="font-medium">{name || "—"}</div>
                                <div className="text-xs text-muted-foreground">
                                  {customer.customerEmail || "—"}
                                </div>
                              </TableCell>
                              <TableCell className="max-w-80 truncate">
                                {formatAddress(address) || "—"}
                              </TableCell>
                              <TableCell>
                                {missing.length ? (
                                  <Badge
                                    variant="destructive"
                                    title={missing.join(", ")}
                                  >
                                    {t("missingFields")}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">{t("ready")}</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  {importPreview.customers.length > 5 && (
                    <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                      {t("previewMore", {
                        count: importPreview.customers.length - 5,
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  importing ||
                  !importPreview.customers.length ||
                  Boolean(importPreview.error) ||
                  importPreview.invalidRows.length > 0
                }
              >
                {importing && <Loader2 className="animate-spin" />}
                {t("import")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
