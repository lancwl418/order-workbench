"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import {
  EXCEPTION_TYPE_COLORS,
  EXCEPTION_STATUS_COLORS,
  EXCEPTION_SEVERITY_COLORS,
} from "@/lib/constants";
import { timeAgo, getTrackingUrl } from "@/lib/utils";
import { generateExceptionEmail } from "@/lib/email-templates";
import type { ExceptionWithRelations } from "@/types";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Search, CheckCircle2, User, AlertTriangle, Mail, Eye, Code } from "lucide-react";

export function ExceptionCard({
  exception,
  onInvestigate,
  onResolve,
  onEmailSent,
}: {
  exception: ExceptionWithRelations;
  onInvestigate: (id: string) => void;
  onResolve: (id: string) => void;
  onEmailSent?: () => void;
}) {
  const tException = useTranslations("exception");
  const tExceptions = useTranslations("exceptions");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending] = useState(false);
  const [bodyTab, setBodyTab] = useState<"preview" | "html">("preview");

  const typeColor =
    EXCEPTION_TYPE_COLORS[exception.type] || { bg: "bg-gray-100", text: "text-gray-700" };
  const statusColor =
    EXCEPTION_STATUS_COLORS[exception.status] || { bg: "bg-gray-100", text: "text-gray-700" };
  const severityColor =
    EXCEPTION_SEVERITY_COLORS[exception.severity] || { bg: "bg-gray-100", text: "text-gray-700" };

  const typeLabel = tException.has(`type.${exception.type}`) ? tException(`type.${exception.type}`) : exception.type;
  const statusLabel = tException.has(`status.${exception.status}`) ? tException(`status.${exception.status}`) : exception.status;
  const severityLabel = tException.has(`severity.${exception.severity}`) ? tException(`severity.${exception.severity}`) : exception.severity;

  function openEmailDialog() {
    const trackingNumber = exception.shipment?.trackingNumber || exception.order.trackingNumber;
    const carrier = exception.shipment?.carrier || null;
    const generated = generateExceptionEmail({
      type: exception.type,
      customerName: exception.order.customerName,
      orderNumber: exception.order.shopifyOrderNumber,
      trackingNumber,
      carrier,
      dayCount: exception.transitDays ?? exception.daysSinceLabel,
    });
    setEmailSubject(generated.subject);
    setEmailBody(generated.body);
    setEmailOpen(true);
  }

  async function handleSendEmail() {
    setSending(true);
    try {
      const res = await fetch(`/api/exceptions/${exception.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || tExceptions("emailFailed"));
        return;
      }
      toast.success(tExceptions("emailSent"));
      setEmailOpen(false);
      onEmailSent?.();
    } catch {
      toast.error(tExceptions("emailFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="border">
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        {/* Header: order link + badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <Link
              href={`/orders/${exception.order.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              #{exception.order.shopifyOrderNumber || exception.order.id.slice(0, 8)}
            </Link>
            {exception.order.customerName && (
              <p className="text-xs text-muted-foreground">
                {exception.order.customerName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {exception.response?.respondedAt && (
              <Badge
                variant="outline"
                className={`border-0 text-[10px] px-1.5 ${
                  exception.response.responseType === "RESHIP"
                    ? "bg-blue-50 text-blue-700"
                    : exception.response.responseType === "REFUND"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-purple-50 text-purple-700"
                }`}
              >
                {exception.response.responseType === "RESHIP"
                  ? "Reship"
                  : exception.response.responseType === "REFUND"
                  ? "Refund"
                  : "Contact"}
              </Badge>
            )}
            {exception.customerEmailed && !exception.response?.respondedAt && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-0 text-[10px] px-1.5"
              >
                {tExceptions("emailed")}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`${severityColor.bg} ${severityColor.text} border-0 text-[10px] px-1.5`}
            >
              {severityLabel}
            </Badge>
          </div>
        </div>

        {/* Exception type + status */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge
            variant="outline"
            className={`${typeColor.bg} ${typeColor.text} border-0 text-[10px]`}
          >
            {typeLabel}
          </Badge>
          <Badge
            variant="outline"
            className={`${statusColor.bg} ${statusColor.text} border-0 text-[10px]`}
          >
            {statusLabel}
          </Badge>
        </div>

        {/* Days count - prominent */}
        {exception.daysSinceLabel != null && (
          <p className="text-sm font-semibold text-red-600">
            {exception.daysSinceLabel} {tExceptions("days")}
          </p>
        )}
        {exception.transitDays != null && (
          <p className="text-sm font-semibold text-amber-600">
            {exception.transitDays} {tExceptions("businessDaysInTransit")}
          </p>
        )}
        {exception.hoursSincePaid != null && (
          <p className="text-sm font-semibold text-purple-600">
            {Math.floor(exception.hoursSincePaid / 24)}d {exception.hoursSincePaid % 24}h {tExceptions("sincePaid")}
          </p>
        )}

        {/* Context info */}
        <div className="text-xs text-muted-foreground space-y-0.5">
          {exception.shipment && (
            <p>
              {exception.shipment.carrier && `${exception.shipment.carrier} - `}
              {exception.shipment.trackingNumber ? (
                (() => {
                  const url = getTrackingUrl(exception.shipment!.carrier, exception.shipment!.trackingNumber!);
                  return url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                      {exception.shipment!.trackingNumber}
                    </a>
                  ) : exception.shipment!.trackingNumber;
                })()
              ) : tExceptions("noTracking")}
            </p>
          )}
          {exception.shipment?.shippedAt && (
            <p>
              {tExceptions("fulfilled")} {new Date(exception.shipment.shippedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          )}
          <p className="text-muted-foreground/70">
            {tExceptions("detected")} {timeAgo(exception.detectedAt)}
          </p>
          {exception.order.internalStatus && (
            <p>
              {tExceptions("orderStatus")} {tStatus.has(exception.order.internalStatus) ? tStatus(exception.order.internalStatus) : exception.order.internalStatus}
            </p>
          )}
        </div>

        {/* Owner */}
        {exception.owner && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{exception.owner}</span>
          </div>
        )}

        {/* Note */}
        {exception.note && (
          <p className="text-xs bg-muted/50 rounded p-1.5 text-muted-foreground">
            {exception.note}
          </p>
        )}

        {/* Customer response */}
        {exception.response?.respondedAt && (
          <div className="text-xs space-y-1">
            {exception.response.responseType === "RESHIP" && (
              <p className="text-blue-600">
                {exception.response.needByDate
                  ? `Need by: ${new Date(exception.response.needByDate).toLocaleDateString()}`
                  : exception.response.noRush
                  ? "No rush"
                  : null}
              </p>
            )}
            {exception.response.comments && (
              <p className="bg-blue-50/50 rounded p-1.5 text-blue-700">
                <span className="font-medium">Customer: </span>
                {exception.response.comments}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        {(exception.status === "OPEN" || exception.status === "INVESTIGATING") && (
          <div className="flex items-center gap-1.5 pt-1">
            {exception.status === "OPEN" && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => onInvestigate(exception.id)}
              >
                <Search className="h-3 w-3" />
                {tExceptions("investigate")}
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              onClick={() => setConfirmOpen(true)}
            >
              <CheckCircle2 className="h-3 w-3" />
              {tExceptions("resolve")}
            </Button>
            {exception.order.customerEmail && (
              <Button
                size="xs"
                variant="outline"
                onClick={openEmailDialog}
              >
                <Mail className="h-3 w-3" />
                {tExceptions("emailCustomer")}
              </Button>
            )}
          </div>
        )}
        {exception.status !== "OPEN" && exception.status !== "INVESTIGATING" && exception.status !== "RESOLVED" && exception.order.customerEmail && (
          <div className="flex items-center gap-1.5 pt-1">
            <Button
              size="xs"
              variant="outline"
              onClick={openEmailDialog}
            >
              <Mail className="h-3 w-3" />
              {tExceptions("emailCustomer")}
            </Button>
          </div>
        )}

        {/* Resolve confirmation dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent showCloseButton={false} className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                {tExceptions("confirmResolveTitle")}
              </DialogTitle>
              <DialogDescription>
                {tExceptions("confirmResolveMessage", {
                  type: typeLabel,
                  orderNumber: exception.order.shopifyOrderNumber || exception.order.id.slice(0, 8),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="sm" />}>
                {tCommon("cancel")}
              </DialogClose>
              <Button
                size="sm"
                onClick={() => {
                  setConfirmOpen(false);
                  onResolve(exception.id);
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {tExceptions("confirmResolve")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Email preview dialog */}
        <Dialog open={emailOpen} onOpenChange={(open) => { setEmailOpen(open); if (open) setBodyTab("preview"); }}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                {tExceptions("emailDialogTitle")}
              </DialogTitle>
              <DialogDescription>
                #{exception.order.shopifyOrderNumber || exception.order.id.slice(0, 8)} — {exception.order.customerName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{tExceptions("emailTo")}</label>
                <p className="text-sm mt-0.5">{exception.order.customerEmail}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{tExceptions("emailSubject")}</label>
                <Input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="mt-0.5"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">{tExceptions("emailBody")}</label>
                  <div className="flex gap-0 border rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setBodyTab("preview")}
                      className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 transition-colors ${bodyTab === "preview" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyTab("html")}
                      className={`px-2.5 py-1 text-xs font-medium flex items-center gap-1 transition-colors ${bodyTab === "html" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
                    >
                      <Code className="h-3 w-3" />
                      HTML
                    </button>
                  </div>
                </div>
                {bodyTab === "preview" ? (
                  <RichTextEditor
                    content={emailBody}
                    onChange={setEmailBody}
                  />
                ) : (
                  <Textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={14}
                    className="font-mono text-xs"
                  />
                )}
                {/* Resolution buttons preview (non-editable, appended at send time) */}
                <div className="border rounded-md p-3 bg-muted/30 text-center space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">How would you like us to resolve this?</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded">Reship My Order</span>
                    <span className="inline-block px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded">Request Refund</span>
                    <span className="inline-block px-3 py-1.5 bg-gray-500 text-white text-xs font-semibold rounded">Contact Support</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">These buttons will be added automatically when sent</p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="sm" />}>
                {tCommon("cancel")}
              </DialogClose>
              <Button
                size="sm"
                onClick={handleSendEmail}
                disabled={sending || !emailSubject || !emailBody}
              >
                <Mail className="h-3.5 w-3.5" />
                {sending ? tExceptions("emailSending") : tExceptions("emailSend")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
