"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/orders/status-badge";
import { INTERNAL_STATUSES, PRINT_STATUS_COLORS, EXCEPTION_TYPE_COLORS, EXCEPTION_STATUS_COLORS } from "@/lib/constants";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Package, Loader2, AlertTriangle, Image, ExternalLink, Pencil, X, Check, Undo2, Upload, MessageSquare, Send, Paperclip, FileText, Image as ImageIcon, Truck, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { OrderWithRelations, OrderException, CsCommentWithUser } from "@/types";
import type { ResolvedPrintFile } from "@/lib/drip/resolve-gang-sheet";
import { MentionInput } from "@/components/cs/mention-input";
import { OmsPushDialog } from "@/components/orders/oms-push-dialog";

type LogEntry = {
  id: string;
  action: string;
  message: string | null;
  createdAt: string | Date;
  user?: { displayName: string | null; username: string } | null;
};

type ShipmentEntry = {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  status: string | null;
  sourceType: string;
  syncStatus: string | null;
  shippedAt: string | null;
  createdAt: string;
  providerName: string | null;
  externalShipmentId: string | null;
  providerRawJson: Record<string, unknown> | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("orderDetail");
  const tStatus = useTranslations("status");
  const tPrint = useTranslations("printStatus");
  const tException = useTranslations("exception");
  const tCommon = useTranslations("common");
  const tOms = useTranslations("oms");

  const { data: order, mutate } = useSWR<OrderWithRelations>(
    `/api/orders/${params.id}`,
    fetcher
  );

  const { data: shipments, mutate: mutateShipments } = useSWR<ShipmentEntry[]>(
    order ? `/api/shipments?orderId=${order.id}` : null,
    fetcher
  );

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [omsPushOpen, setOmsPushOpen] = useState(false);
  const [refreshingTracking, setRefreshingTracking] = useState(false);
  const [editingServerNo, setEditingServerNo] = useState(false);
  const [serverNoInput, setServerNoInput] = useState("");
  const [savingServerNo, setSavingServerNo] = useState(false);
  const [fetchingServerNo, setFetchingServerNo] = useState(false);

  // Shipment tracking editing
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [shipTrackingInput, setShipTrackingInput] = useState("");
  const [shipCarrierInput, setShipCarrierInput] = useState("");
  const [savingShipment, setSavingShipment] = useState(false);
  // New tracking (when no shipments exist)
  const [addingTracking, setAddingTracking] = useState(false);
  const [newTrackingNumber, setNewTrackingNumber] = useState("");
  const [newCarrier, setNewCarrier] = useState("");
  const [savingNewTracking, setSavingNewTracking] = useState(false);

  // Delivery method editing (double confirm)
  const [editDeliveryOpen, setEditDeliveryOpen] = useState(false);
  const [deliveryMethodInput, setDeliveryMethodInput] = useState("");
  const [confirmDeliveryOpen, setConfirmDeliveryOpen] = useState(false);
  const [savingDeliveryMethod, setSavingDeliveryMethod] = useState(false);

  useEffect(() => {
    if (order?.notes) setNotes(order.notes);
  }, [order?.notes]);

  if (!order) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        {t("loading")}
      </div>
    );
  }

  async function updateStatus(newStatus: string) {
    const res = await fetch(`/api/orders/${order!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ internalStatus: newStatus }),
    });
    if (res.ok) {
      toast.success(`Status → ${tStatus.has(newStatus) ? tStatus(newStatus) : newStatus}`);
      mutate();
    } else {
      toast.error("Failed to update status");
    }
  }

  async function saveNotes() {
    setSaving(true);
    const res = await fetch(`/api/orders/${order!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      toast.success(t("saveNotes"));
      mutate();
    } else {
      toast.error("Failed to save notes");
    }
    setSaving(false);
  }

  async function refreshOmsTracking() {
    setRefreshingTracking(true);
    try {
      const res = await fetch(`/api/oms/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order!.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.message) {
        toast.info(tOms("noTrackingYet"));
      } else {
        toast.success(tOms("trackingUpdated"));
      }
      mutate();
      mutateShipments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh tracking");
    } finally {
      setRefreshingTracking(false);
    }
  }

  async function fetchServerNo() {
    setFetchingServerNo(true);
    try {
      const res = await fetch(`/api/oms/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order!.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      mutate();
      mutateShipments();
      if (data.shipment?.trackingNumber || data.tracking) {
        toast.success(tOms("trackingNoFetched"));
      } else {
        toast.info(tOms("notAssignedYet"));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setFetchingServerNo(false);
    }
  }

  async function saveServerNo() {
    if (!serverNoInput.trim() || !omsShipment) return;
    setSavingServerNo(true);
    try {
      const res = await fetch(`/api/shipments/${omsShipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: serverNoInput.trim() }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success(tOms("trackingNoUpdated"));
      setEditingServerNo(false);
      // Auto-sync to Shopify
      syncToShopify(omsShipment.id);
      mutate();
      mutateShipments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingServerNo(false);
    }
  }

  async function syncToShopify(shipmentId: string) {
    try {
      const res = await fetch("/api/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || "Sync failed");
      toast.success(tOms("syncedToShopify"));
      mutate();
      mutateShipments();
    } catch (e) {
      toast.error(`Shopify sync: ${e instanceof Error ? e.message : "Failed"}`);
    }
  }

  async function saveShipmentTracking(shipmentId: string) {
    setSavingShipment(true);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: shipTrackingInput.trim() || undefined,
          carrier: shipCarrierInput.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Tracking updated");
      setEditingShipmentId(null);
      mutate();
      mutateShipments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingShipment(false);
    }
  }

  async function createNewTracking() {
    if (!newTrackingNumber.trim()) return;
    setSavingNewTracking(true);
    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order!.id,
          trackingNumber: newTrackingNumber.trim(),
          carrier: newCarrier.trim() || undefined,
          sourceType: "MANUAL",
        }),
      });
      if (!res.ok) throw new Error("Failed to create shipment");
      toast.success("Tracking added");
      setAddingTracking(false);
      setNewTrackingNumber("");
      setNewCarrier("");
      mutate();
      mutateShipments();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingNewTracking(false);
    }
  }

  async function saveDeliveryMethod() {
    setSavingDeliveryMethod(true);
    try {
      const res = await fetch(`/api/orders/${order!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shippingMethod: deliveryMethodInput.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Delivery method updated");
      setConfirmDeliveryOpen(false);
      setEditDeliveryOpen(false);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingDeliveryMethod(false);
    }
  }

  const omsShipment = shipments?.find((s) => s.providerName === "eccangtms");
  const omsRaw = omsShipment?.providerRawJson as Record<string, unknown> | null;

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {tCommon("back")}
        </Button>
        <h1 className="text-xl sm:text-2xl font-semibold">
          {t("orderPrefix")}{order.shopifyOrderNumber || order.id.slice(0, 8)}
        </h1>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{t("orderLabel")}</span>
          <StatusBadge status={order.internalStatus} />
        </div>
        {order.printStatus && order.printStatus !== "NONE" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{t("printLabel")}</span>
            <Badge
              variant="outline"
              className={`${PRINT_STATUS_COLORS[order.printStatus]?.bg || "bg-gray-100"} ${PRINT_STATUS_COLORS[order.printStatus]?.text || "text-gray-500"} border-0 text-xs`}
            >
              {tPrint.has(order.printStatus) ? tPrint(order.printStatus) : order.printStatus}
            </Badge>
          </div>
        )}
        {order.shopifyOrderId && process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() =>
              window.open(
                `https://${process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN}/admin/orders/${order.shopifyOrderId}`,
                "_blank"
              )
            }
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Shopify
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Order Info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("orderDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t("customer")}</span>
                <p className="font-medium">{order.customerName || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("email")}</span>
                <p className="font-medium">{order.customerEmail || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("orderDate")}</span>
                <p className="font-medium">
                  {formatDateTime(order.shopifyCreatedAt)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("total")}</span>
                <p className="font-medium">
                  {order.totalPrice
                    ? `$${parseFloat(String(order.totalPrice)).toFixed(2)}`
                    : "-"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("shippingRoute")}</span>
                <p>
                  <StatusBadge status={order.shippingRoute} />
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("labelStatus")}</span>
                <p>
                  <StatusBadge status={order.labelStatus} />
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("tracking")}</span>
                <p className="font-mono text-sm">
                  {order.trackingNumber || "-"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("deliveryMethod")}</span>
                <div className="flex items-center gap-1.5">
                  <p className="font-medium">
                    {order.shippingMethod ? (
                      <Badge
                        variant="outline"
                        className={`text-xs border-0 ${
                          order.shippingMethod.toLowerCase().includes("express")
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {order.shippingMethod}
                      </Badge>
                    ) : "-"}
                  </p>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      setDeliveryMethodInput(order.shippingMethod || "");
                      setEditDeliveryOpen(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">{t("priority")}</span>
                <p className="font-medium">{order.priority}</p>
              </div>
            </div>

            {order.tags.length > 0 && (
              <div>
                <span className="text-sm text-muted-foreground">{t("tags")}</span>
                <div className="flex gap-1 mt-1">
                  {order.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle>{t("actions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {t("updateStatus")}
              </label>
              <Select
                value={order.internalStatus}
                onValueChange={(v) => v && updateStatus(v)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {tStatus.has(order.internalStatus) ? tStatus(order.internalStatus) : order.internalStatus}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {INTERNAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tStatus.has(s) ? tStatus(s) : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                {t("notes")}
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder={t("notesPlaceholder")}
              />
              <Button
                size="sm"
                className="mt-2"
                onClick={saveNotes}
                disabled={saving}
              >
                <Save className="h-3 w-3 mr-1" />
                {saving ? t("saving") : t("saveNotes")}
              </Button>
            </div>

            {/* OMS Push — hidden for Express orders */}
            {!omsShipment && !order.shippingMethod?.toLowerCase().includes("express") && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setOmsPushOpen(true)}
                >
                  <Truck className="h-3.5 w-3.5 mr-1" />
                  {tOms("pushToOms")}
                </Button>
              </div>
            )}

            {/* CS Comments */}
            <CsCommentsSection orderId={order.id} />
          </CardContent>
        </Card>

        {/* Active Exceptions */}
        {order.exceptions && (order.exceptions as unknown as OrderException[]).length > 0 && (
          <Card className="md:col-span-3 border-red-200 bg-red-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-4 w-4" />
                {t("exceptions")} ({(order.exceptions as unknown as OrderException[]).length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(order.exceptions as unknown as (OrderException & { shipment?: { trackingNumber?: string; carrier?: string; status?: string } | null })[]).map((ex) => {
                  const typeColor = EXCEPTION_TYPE_COLORS[ex.type] || { bg: "bg-gray-100", text: "text-gray-700" };
                  const statusColor = EXCEPTION_STATUS_COLORS[ex.status] || { bg: "bg-gray-100", text: "text-gray-700" };
                  const typeLabel = tException.has(`type.${ex.type}`) ? tException(`type.${ex.type}`) : ex.type;
                  const statusLabel = tException.has(`status.${ex.status}`) ? tException(`status.${ex.status}`) : ex.status;
                  return (
                    <div key={ex.id} className="p-3 rounded-md border bg-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className={`${typeColor.bg} ${typeColor.text} border-0 text-[10px]`}>
                          {typeLabel}
                        </Badge>
                        <Badge variant="outline" className={`${statusColor.bg} ${statusColor.text} border-0 text-[10px]`}>
                          {statusLabel}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {ex.daysSinceLabel != null && <p>{ex.daysSinceLabel} {t("daysSinceLabel")}</p>}
                        {ex.transitDays != null && <p>{ex.transitDays} business days in transit</p>}
                        {ex.hoursSincePaid != null && <p>{ex.hoursSincePaid}{t("hoursSincePaid")}</p>}
                        {ex.shipment && (
                          <p>{ex.shipment.carrier} - {ex.shipment.trackingNumber || t("noTrackingShort")}</p>
                        )}
                        {ex.note && <p className="bg-muted/50 rounded p-1">{ex.note}</p>}
                        <p>{tCommon("system")} {timeAgo(ex.detectedAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Line Items */}
        <LineItemsSection order={order} />

        {/* Print Files */}
        <PrintFilesSection
          orderId={order.id}
          orderItems={order.orderItems}
          canReplace={["OPEN", "REVIEW"].includes(order.internalStatus) || ["NONE", "READY", "IN_QUEUE"].includes(order.printStatus)}
          onUpdated={mutate}
        />

        {/* Shipments */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t("shipments")} ({shipments?.length || 0})
              </CardTitle>
              {!addingTracking && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddingTracking(true)}
                >
                  + {t("addTracking")}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {shipments?.map((shipment) => (
                <div
                  key={shipment.id}
                  className="p-3 rounded-md border"
                >
                  {editingShipmentId === shipment.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={shipTrackingInput}
                          onChange={(e) => setShipTrackingInput(e.target.value)}
                          placeholder={t("trackingNumber")}
                          className="h-8 text-sm font-mono flex-1"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          value={shipCarrierInput}
                          onChange={(e) => setShipCarrierInput(e.target.value)}
                          placeholder={t("carrier")}
                          className="h-8 text-sm flex-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => saveShipmentTracking(shipment.id)}
                          disabled={savingShipment}
                        >
                          {savingShipment ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => setEditingShipmentId(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-sm">
                          {shipment.trackingNumber || t("noTrackingShort")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {shipment.carrier || t("unknownCarrier")} &middot;{" "}
                          {shipment.sourceType}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          {shipment.status && (
                            <StatusBadge status={shipment.status} />
                          )}
                          {shipment.syncStatus && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {t("sync")}: {shipment.syncStatus}
                            </p>
                          )}
                        </div>
                        <button
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => {
                            setShipTrackingInput(shipment.trackingNumber || "");
                            setShipCarrierInput(shipment.carrier || "");
                            setEditingShipmentId(shipment.id);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Add new tracking */}
              {addingTracking && (
                <div className="p-3 rounded-md border border-dashed space-y-2">
                  <Input
                    value={newTrackingNumber}
                    onChange={(e) => setNewTrackingNumber(e.target.value)}
                    placeholder={t("trackingNumber")}
                    className="h-8 text-sm font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={newCarrier}
                      onChange={(e) => setNewCarrier(e.target.value)}
                      placeholder={t("carrier")}
                      className="h-8 text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={createNewTracking}
                      disabled={savingNewTracking || !newTrackingNumber.trim()}
                    >
                      {savingNewTracking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      {t("save")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingTracking(false);
                        setNewTrackingNumber("");
                        setNewCarrier("");
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {(!shipments || shipments.length === 0) && !addingTracking && (
                <p className="text-sm text-muted-foreground">{t("noShipments")}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* OMS Shipment */}
        {omsShipment && (
          <Card className="md:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  {tOms("omsShipment")}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {((omsRaw?.serverNo as string) || omsShipment.trackingNumber) && omsShipment.syncStatus !== "SYNCED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncToShopify(omsShipment.id)}
                    >
                      <Upload className="h-3 w-3" />
                      {tOms("syncToShopify")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshOmsTracking}
                    disabled={refreshingTracking}
                  >
                    {refreshingTracking ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {refreshingTracking ? tOms("refreshing") : tOms("refreshTracking")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{tOms("orderNumber")}</span>
                  <p className="font-mono font-medium">{omsShipment.externalShipmentId || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{tOms("serverNo")}</span>
                  {editingServerNo ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Input
                        value={serverNoInput}
                        onChange={(e) => setServerNoInput(e.target.value)}
                        className="h-7 text-xs font-mono"
                        placeholder="e.g. 9400111..."
                      />
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={saveServerNo} disabled={savingServerNo}>
                        {savingServerNo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingServerNo(false)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono font-medium">
                        {(omsRaw?.serverNo as string) || omsShipment.trackingNumber || (
                          <span className="text-muted-foreground font-normal">{tOms("notAssignedYet")}</span>
                        )}
                      </p>
                      {!((omsRaw?.serverNo as string) || omsShipment.trackingNumber) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={fetchServerNo}
                          disabled={fetchingServerNo}
                        >
                          {fetchingServerNo ? <Loader2 className="h-3 w-3 animate-spin" /> : tOms("fetchTrackingNo")}
                        </Button>
                      )}
                      <button
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => {
                          setServerNoInput((omsRaw?.serverNo as string) || omsShipment.trackingNumber || "");
                          setEditingServerNo(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">{tOms("carrier")}</span>
                  <p className="font-medium">{(omsRaw?.productName as string) || omsShipment.carrier || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{tOms("trackingStatus")}</span>
                  <p>{omsShipment.status ? <StatusBadge status={omsShipment.status} /> : tOms("noTrackingYet")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">{tOms("shippingCost")}</span>
                  <p className="font-medium">
                    {(omsRaw?.totalPrice as number) != null
                      ? `$${Number(omsRaw!.totalPrice).toFixed(2)}`
                      : "-"}
                  </p>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">{tOms("shopifySync")}</span>
                  <p className="font-medium">
                    {omsShipment.syncStatus === "SYNCED" ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{tOms("synced")}</Badge>
                    ) : omsShipment.syncStatus === "FAILED" ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{tOms("syncFailed")}</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">{tOms("notSynced")}</Badge>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* OMS Push Dialog */}
        <OmsPushDialog
          orderId={order.id}
          open={omsPushOpen}
          onOpenChange={setOmsPushOpen}
          onSuccess={() => {
            setOmsPushOpen(false);
            mutate();
          }}
        />

        {/* Activity Log */}
        <Card>
          <CardHeader>
            <CardTitle>{t("activityLog")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {order.orderLogs && order.orderLogs.length > 0 ? (
                (order.orderLogs as unknown as LogEntry[]).map((log) => (
                  <div key={log.id} className="text-sm border-l-2 pl-3 py-1">
                    <p className="font-medium">{log.action.replace(/_/g, " ")}</p>
                    {log.message && (
                      <p className="text-muted-foreground">{log.message}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {log.user?.displayName || log.user?.username || tCommon("system")}{" "}
                      &middot; {timeAgo(log.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("noActivity")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Delivery Method — Step 1 */}
      <Dialog open={editDeliveryOpen} onOpenChange={(open) => {
        if (!open) setEditDeliveryOpen(false);
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("editDeliveryMethod")}</DialogTitle>
            <DialogDescription>
              {t("currentValue")}: {order.shippingMethod || "-"}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deliveryMethodInput}
            onChange={(e) => setDeliveryMethodInput(e.target.value)}
            placeholder={t("deliveryMethod")}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDeliveryOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => {
                setEditDeliveryOpen(false);
                setConfirmDeliveryOpen(true);
              }}
              disabled={deliveryMethodInput === (order.shippingMethod || "")}
            >
              {t("change")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Delivery Method — Step 2 (Confirm) */}
      <Dialog open={confirmDeliveryOpen} onOpenChange={(open) => {
        if (!open) {
          setConfirmDeliveryOpen(false);
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("confirmChange")}</DialogTitle>
            <DialogDescription>
              {t("deliveryMethodConfirmMsg", {
                from: order.shippingMethod || "-",
                to: deliveryMethodInput || "-",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setConfirmDeliveryOpen(false);
              setEditDeliveryOpen(true);
            }}>
              {tCommon("back")}
            </Button>
            <Button
              variant="destructive"
              onClick={saveDeliveryMethod}
              disabled={savingDeliveryMethod}
            >
              {savingDeliveryMethod ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t("confirmChange")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineItemsSection({ order }: { order: OrderWithRelations }) {
  const t = useTranslations("orderDetail");

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>{t("lineItems")} ({order.orderItems.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {order.orderItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 rounded-md border"
            >
              <div>
                <p className="font-medium">{item.title}</p>
                {item.variantTitle && (
                  <p className="text-sm text-muted-foreground">
                    {item.variantTitle}
                  </p>
                )}
                {item.sku && (
                  <p className="text-xs text-muted-foreground font-mono">
                    {t("sku")}: {item.sku}
                  </p>
                )}
                {item.designFileUrl && (
                  <a
                    href={item.designFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
                  >
                    {t("printReadyFile")}
                  </a>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm">{t("qty")}: {item.quantity}</p>
                <p className="text-sm font-medium">
                  ${parseFloat(String(item.price)).toFixed(2)}
                </p>
                {item.isPrinted && (
                  <Badge
                    variant="outline"
                    className="text-xs bg-green-100 text-green-700 border-0"
                  >
                    {t("printed")}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type PrintFileWithSource = ResolvedPrintFile & {
  sourceUrl: string;
  orderItemIds: string[];
  hasOriginal: boolean;
  originalSourceUrl: string | null;
  version: "current" | "original";
};

function PrintFilesSection({
  orderId,
  orderItems,
  canReplace,
  onUpdated,
}: {
  orderId: string;
  orderItems: { id: string; designFileUrl: string | null }[];
  canReplace: boolean;
  onUpdated: () => void;
}) {
  const t = useTranslations("orderDetail");
  const tCommon = useTranslations("common");

  const [files, setFiles] = useState<PrintFileWithSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingNew, setUploadingNew] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<PrintFileWithSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);

  async function handleUploadNew(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetItem = orderItems.find((i) => !i.designFileUrl) || orderItems[0];
    if (!targetItem) {
      toast.error("No order item to attach file to");
      return;
    }
    setUploadingNew(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        throw new Error(data.error || "Upload failed");
      }
      const { url } = await uploadRes.json();
      const patchRes = await fetch(`/api/order-items/${targetItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designFileUrl: url }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json();
        throw new Error(data.error || "Failed to set print file");
      }
      toast.success("Print file uploaded");
      onUpdated();
      loadPrintFiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingNew(false);
      if (newFileInputRef.current) newFileInputRef.current.value = "";
    }
  }

  async function loadPrintFiles() {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/print-files`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setFiles(data.files || []);
      setLoaded(true);
    } catch {
      toast.error("Failed to load print files");
    } finally {
      setLoading(false);
    }
  }

  async function doReplace(file: PrintFileWithSource, newUrl: string) {
    setReplacing(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/replace-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: file.sourceUrl, newUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast.success("Print file replaced");
      setEditingIdx(null);
      setEditUrl("");
      loadPrintFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to replace file");
    } finally {
      setReplacing(false);
    }
  }

  async function handleUpload(file: PrintFileWithSource, uploadedFile: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadedFile);
      form.append("originalFilename", file.filename);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        throw new Error(data.error || "Upload failed");
      }
      const { url } = await uploadRes.json();
      await doReplace(file, url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  }

  async function handleRevert(file: PrintFileWithSource) {
    if (!file.originalSourceUrl) return;
    await doReplace(file, file.originalSourceUrl);
  }

  async function handleDeleteConfirmed() {
    if (!deleteConfirmFile) return;
    setDeleting(true);
    try {
      for (const itemId of deleteConfirmFile.orderItemIds) {
        const res = await fetch(`/api/order-items/${itemId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to delete");
        }
      }
      toast.success(t("fileDeleted"));
      setDeleteConfirmFile(null);
      onUpdated();
      loadPrintFiles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete file");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Image className="h-4 w-4" />
            {t("printFiles")}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={loadPrintFiles}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Image className="h-3 w-3" />
            )}
            {loading ? tCommon("loading") : loaded ? t("refresh") : t("loadPrintFiles")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!loaded && !loading && (
          <p className="text-sm text-muted-foreground">
            {t("loadPrintFilesDesc")}
          </p>
        )}
        {loaded && files.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("noPrintFiles")}
            </p>
            {orderItems.length > 0 && (
              <div>
                <input
                  ref={newFileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUploadNew}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => newFileInputRef.current?.click()}
                  disabled={uploadingNew}
                >
                  {uploadingNew ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {uploadingNew ? tCommon("uploading") : t("uploadPrintFile")}
                </Button>
              </div>
            )}
          </div>
        )}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file, i) => (
              <div
                key={i}
                className={`p-3 rounded-md border space-y-2 ${file.version === "original" ? "bg-muted/30 border-dashed" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {file.filename}
                    </p>
                    {file.version === "original" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        {t("original")}
                      </span>
                    )}
                    {file.version === "current" && file.hasOriginal && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                        {t("replaced")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {canReplace && file.version === "current" && editingIdx !== i && (
                      <button
                        onClick={() => {
                          setEditingIdx(i);
                          setEditUrl("");
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        title={t("replaceFile")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canReplace && file.version === "current" && file.hasOriginal && (
                      <button
                        onClick={() => handleRevert(file)}
                        className="text-muted-foreground hover:text-foreground"
                        title={t("revertToOriginal")}
                        disabled={replacing}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canReplace && file.version === "current" && (
                      <button
                        onClick={() => setDeleteConfirmFile(file)}
                        className="text-muted-foreground hover:text-destructive"
                        title={t("deletePrintFile")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {tCommon("open")}
                    </a>
                  </div>
                </div>
                {editingIdx === i && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        placeholder={t("pasteNewUrl")}
                        className="text-xs h-8"
                        autoFocus
                      />
                      <Button
                        size="xs"
                        onClick={() => doReplace(file, editUrl.trim())}
                        disabled={replacing || uploading || !editUrl.trim()}
                      >
                        {replacing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setEditingIdx(null)}
                        disabled={replacing || uploading}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(file, f);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={replacing || uploading}
                      >
                        {uploading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        {uploading ? tCommon("uploading") : t("uploadFile")}
                      </Button>
                      <span className="text-[10px] text-muted-foreground">
                        {t("orPasteUrl")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {canReplace && orderItems.length > 0 && (
              <div className="mt-3">
                <input
                  ref={newFileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleUploadNew}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => newFileInputRef.current?.click()}
                  disabled={uploadingNew}
                >
                  {uploadingNew ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {uploadingNew ? tCommon("uploading") : t("uploadPrintFile")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Delete confirmation dialog */}
        <Dialog open={!!deleteConfirmFile} onOpenChange={(open) => !open && setDeleteConfirmFile(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirmDeleteFile")}</DialogTitle>
              <DialogDescription>
                {t("confirmDeleteFileDesc", { filename: deleteConfirmFile?.filename || "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteConfirmFile(null)} disabled={deleting}>
                {tCommon("cancel")}
              </Button>
              <Button variant="destructive" onClick={handleDeleteConfirmed} disabled={deleting}>
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {tCommon("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ─── CS Comments Section ───────────────────────────────────────── */

function CsCommentsSection({ orderId }: { orderId: string }) {
  const t = useTranslations("orderDetail");
  const tCommon = useTranslations("common");

  const { data: comments, mutate } = useSWR<CsCommentWithUser[]>(
    `/api/orders/${orderId}/cs-comments`,
    fetcher
  );

  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<{ url: string; filename: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/cs", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }
        const data = await res.json();
        setAttachments((prev) => [...prev, { url: data.url, filename: data.filename }]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit() {
    if (!content.trim() && attachments.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/cs-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content.trim(),
          attachments: attachments.map((a) => a.url),
          mentions,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setContent("");
      setMentions([]);
      setAttachments([]);
      mutate();
      toast.success("Comment added");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t pt-4">
      <label className="text-sm text-muted-foreground mb-2 flex items-center gap-1.5">
        <MessageSquare className="h-3.5 w-3.5" />
        {t("csComments")}
      </label>

      {/* New comment form */}
      <div className="space-y-2 mb-3">
        <MentionInput
          value={content}
          onChange={setContent}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder={t("addComment")}
          rows={2}
          className="text-sm"
          onSubmit={handleSubmit}
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {/\.(png|jpe?g|webp)$/i.test(att.filename) ? (
                  <ImageIcon className="h-3 w-3 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                <span className="max-w-[100px] truncate">{att.filename}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            multiple
            onChange={handleFileUpload}
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
            {uploading ? t("uploading") : t("attach")}
          </Button>
          <Button
            size="xs"
            onClick={handleSubmit}
            disabled={submitting || (!content.trim() && attachments.length === 0)}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t("send")}
          </Button>
        </div>
      </div>

      {/* Comments list */}
      <div className="space-y-2">
        {!comments ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">{t("noComments")}</p>
        ) : (
          comments.map((comment) => {
            const userName = comment.user?.displayName || comment.user?.username || tCommon("system");
            return (
              <div key={comment.id} className="rounded-md border p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{userName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(comment.createdAt)}
                  </span>
                </div>
                {comment.content && (
                  <p className="text-sm whitespace-pre-wrap">
                    {comment.content.split(/(@\S+)/g).map((part, i) =>
                      part.startsWith("@") ? (
                        <span key={i} className="font-medium text-primary">{part}</span>
                      ) : (
                        part
                      )
                    )}
                  </p>
                )}
                {comment.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {comment.attachments.map((url, i) => {
                      const filename = url.split("/").pop() || "file";
                      return (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-blue-600 hover:underline"
                        >
                          {/\.(png|jpe?g|webp)$/i.test(filename) ? (
                            <ImageIcon className="h-3 w-3 shrink-0" />
                          ) : (
                            <FileText className="h-3 w-3 shrink-0" />
                          )}
                          <span className="max-w-[120px] truncate">
                            {filename.replace(/^\d{10,}-/, "")}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
