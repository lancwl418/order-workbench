"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
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
import { StatusBadge } from "@/components/orders/status-badge";
import { INTERNAL_STATUSES, STATUS_LABELS } from "@/lib/constants";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { ArrowLeft, Save, Package, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { OrderWithRelations, OrderException } from "@/types";
import {
  EXCEPTION_TYPE_LABELS,
  EXCEPTION_TYPE_COLORS,
  EXCEPTION_STATUS_LABELS,
  EXCEPTION_STATUS_COLORS,
} from "@/lib/constants";

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
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: order, mutate } = useSWR<OrderWithRelations>(
    `/api/orders/${params.id}`,
    fetcher
  );

  const { data: shipments } = useSWR<ShipmentEntry[]>(
    order ? `/api/shipments?orderId=${order.id}` : null,
    fetcher
  );

  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order?.notes) setNotes(order.notes);
  }, [order?.notes]);

  if (!order) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading order...
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
      toast.success(`Status updated to ${STATUS_LABELS[newStatus]}`);
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
      toast.success("Notes saved");
      mutate();
    } else {
      toast.error("Failed to save notes");
    }
    setSaving(false);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">
          Order #{order.shopifyOrderNumber || order.id.slice(0, 8)}
        </h1>
        <StatusBadge status={order.internalStatus} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Order Info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Customer</span>
                <p className="font-medium">{order.customerName || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Email</span>
                <p className="font-medium">{order.customerEmail || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Order Date</span>
                <p className="font-medium">
                  {formatDateTime(order.shopifyCreatedAt)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Total</span>
                <p className="font-medium">
                  {order.totalPrice
                    ? `$${parseFloat(String(order.totalPrice)).toFixed(2)}`
                    : "-"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Shipping Route</span>
                <p>
                  <StatusBadge status={order.shippingRoute} />
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Label Status</span>
                <p>
                  <StatusBadge status={order.labelStatus} />
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Tracking</span>
                <p className="font-mono text-sm">
                  {order.trackingNumber || "-"}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Priority</span>
                <p className="font-medium">{order.priority}</p>
              </div>
            </div>

            {order.tags.length > 0 && (
              <div>
                <span className="text-sm text-muted-foreground">Tags</span>
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
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                Update Status
              </label>
              <Select
                value={order.internalStatus}
                onValueChange={(v) => v && updateStatus(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERNAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">
                Notes
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Add internal notes..."
              />
              <Button
                size="sm"
                className="mt-2"
                onClick={saveNotes}
                disabled={saving}
              >
                <Save className="h-3 w-3 mr-1" />
                {saving ? "Saving..." : "Save Notes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Active Exceptions */}
        {order.exceptions && (order.exceptions as unknown as OrderException[]).length > 0 && (
          <Card className="md:col-span-3 border-red-200 bg-red-50/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Active Exceptions ({(order.exceptions as unknown as OrderException[]).length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(order.exceptions as unknown as (OrderException & { shipment?: { trackingNumber?: string; carrier?: string; status?: string } | null })[]).map((ex) => {
                  const typeColor = EXCEPTION_TYPE_COLORS[ex.type] || { bg: "bg-gray-100", text: "text-gray-700" };
                  const statusColor = EXCEPTION_STATUS_COLORS[ex.status] || { bg: "bg-gray-100", text: "text-gray-700" };
                  return (
                    <div key={ex.id} className="p-3 rounded-md border bg-white">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className={`${typeColor.bg} ${typeColor.text} border-0 text-[10px]`}>
                          {EXCEPTION_TYPE_LABELS[ex.type] || ex.type}
                        </Badge>
                        <Badge variant="outline" className={`${statusColor.bg} ${statusColor.text} border-0 text-[10px]`}>
                          {EXCEPTION_STATUS_LABELS[ex.status] || ex.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {ex.daysSinceLabel != null && <p>{ex.daysSinceLabel} days since label</p>}
                        {ex.transitDays != null && <p>{ex.transitDays} business days in transit</p>}
                        {ex.hoursSincePaid != null && <p>{ex.hoursSincePaid}h since paid</p>}
                        {ex.shipment && (
                          <p>{ex.shipment.carrier} - {ex.shipment.trackingNumber || "no tracking"}</p>
                        )}
                        {ex.note && <p className="bg-muted/50 rounded p-1">{ex.note}</p>}
                        <p>Detected {timeAgo(ex.detectedAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Line Items */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>
              Line Items ({order.orderItems.length})
            </CardTitle>
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
                        SKU: {item.sku}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm">Qty: {item.quantity}</p>
                    <p className="text-sm font-medium">
                      ${parseFloat(String(item.price)).toFixed(2)}
                    </p>
                    {item.isPrinted && (
                      <Badge
                        variant="outline"
                        className="text-xs bg-green-100 text-green-700 border-0"
                      >
                        Printed
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Shipments */}
        {shipments && shipments.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                Shipments ({shipments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {shipments.map((shipment) => (
                  <div
                    key={shipment.id}
                    className="flex items-center justify-between p-3 rounded-md border"
                  >
                    <div>
                      <p className="font-mono text-sm">
                        {shipment.trackingNumber || "No tracking"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {shipment.carrier || "Unknown carrier"} &middot;{" "}
                        {shipment.sourceType}
                      </p>
                    </div>
                    <div className="text-right">
                      {shipment.status && (
                        <StatusBadge status={shipment.status} />
                      )}
                      {shipment.syncStatus && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Sync: {shipment.syncStatus}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Activity Log */}
        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
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
                      {log.user?.displayName || log.user?.username || "System"}{" "}
                      &middot; {timeAgo(log.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No activity yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
