"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  DollarSign,
  Truck,
  Zap,
  Loader2,
} from "lucide-react";
import type { ExceptionWithRelations } from "@/types";

type Props = {
  exception: ExceptionWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProcessed?: () => void;
};

export function ResolveResponseDialog({
  exception,
  open,
  onOpenChange,
  onProcessed,
}: Props) {
  const [shippingMethod, setShippingMethod] = useState<"standard" | "express">("standard");
  const [note, setNote] = useState("");
  const [processing, setProcessing] = useState(false);

  const responseType = exception.response?.responseType;
  const isReship = responseType === "RESHIP";
  const isRefund = responseType === "REFUND";

  async function handleProcess() {
    setProcessing(true);
    try {
      const body: Record<string, string> = {
        action: isReship ? "RESHIP" : "REFUND",
      };
      if (isReship) {
        body.shippingMethod = shippingMethod;
        if (note.trim()) body.note = note.trim();
      }

      const res = await fetch(`/api/exceptions/${exception.id}/resolve-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to process");
        return;
      }

      if (isReship) {
        toast.success(`Reship order ${data.newOrderName} created`);
      } else {
        toast.success("Refund processed successfully");
      }

      onOpenChange(false);
      onProcessed?.();
    } catch {
      toast.error("Failed to process action");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isReship ? (
              <Package className="h-4 w-4 text-blue-600" />
            ) : (
              <DollarSign className="h-4 w-4 text-amber-600" />
            )}
            {isReship ? "Create Reship Order" : "Process Refund"}
          </DialogTitle>
          <DialogDescription>
            #{exception.order.shopifyOrderNumber || exception.order.id.slice(0, 8)} — {exception.order.customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Customer response info */}
          <div className="bg-muted/50 rounded-md p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Customer chose:</span>
              <Badge
                variant="outline"
                className={`border-0 text-xs ${
                  isReship
                    ? "bg-blue-50 text-blue-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {isReship ? "Reship" : "Refund"}
              </Badge>
            </div>
            {isReship && exception.response?.needByDate && (
              <p className="text-xs text-muted-foreground">
                Need by: {new Date(exception.response.needByDate).toLocaleDateString()}
              </p>
            )}
            {isReship && exception.response?.noRush && (
              <p className="text-xs text-muted-foreground">No rush</p>
            )}
            {exception.response?.comments && (
              <p className="text-xs text-blue-700 bg-blue-50/50 rounded p-2">
                <span className="font-medium">Customer: </span>
                {exception.response.comments}
              </p>
            )}
          </div>

          {/* Refund info */}
          {isRefund && exception.order.totalPrice != null && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Refund amount:</span>
              <span className="font-semibold">{`$${String(exception.order.totalPrice ?? "")}`}</span>
            </div>
          )}

          {/* Reship options */}
          {isReship && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  Shipping Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShippingMethod("standard")}
                    className={`flex items-center gap-2 p-3 rounded-md border text-sm font-medium transition-colors ${
                      shippingMethod === "standard"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Truck className="h-4 w-4" />
                    Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setShippingMethod("express")}
                    className={`flex items-center gap-2 p-3 rounded-md border text-sm font-medium transition-colors ${
                      shippingMethod === "express"
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <Zap className="h-4 w-4" />
                    Express
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Note (optional)
                </label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Add a note to the reship order..."
                  className="text-sm"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Cancel
          </DialogClose>
          <Button
            size="sm"
            onClick={handleProcess}
            disabled={processing}
            className={isReship ? "" : "bg-amber-600 hover:bg-amber-700"}
          >
            {processing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isReship ? (
              <>
                <Package className="h-3.5 w-3.5" />
                {processing ? "Creating..." : "Create Reship Order"}
              </>
            ) : (
              <>
                <DollarSign className="h-3.5 w-3.5" />
                {processing ? "Processing..." : "Process Refund"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
