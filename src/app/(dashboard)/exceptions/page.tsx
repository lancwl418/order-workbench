"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useExceptions, useExceptionCounts } from "@/hooks/use-exceptions";
import { ExceptionCard } from "@/components/exceptions/exception-card";
import { useExceptionActions } from "@/components/exceptions/exception-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  EXCEPTION_TYPE_COLORS,
} from "@/lib/constants";
import {
  Loader2,
  RefreshCw,
  PackageX,
  Clock,
  AlertTriangle,
  Truck,
  Ban,
} from "lucide-react";

type Tab = "shipment" | "processing";

const SHIPMENT_TYPES = [
  "NO_MOVEMENT_AFTER_LABEL",
  "LONG_TRANSIT",
  "DELIVERY_FAILURE",
] as const;

const TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  NO_MOVEMENT_AFTER_LABEL: PackageX,
  LONG_TRANSIT: Truck,
  DELIVERY_FAILURE: Ban,
  PRODUCTION_DELAY: Clock,
};

export default function ExceptionsPage() {
  const tExceptions = useTranslations("exceptions");
  const tException = useTranslations("exception");
  const tCommon = useTranslations("common");

  const [tab, setTab] = useState<Tab>("shipment");
  const { counts, refreshCounts } = useExceptionCounts();

  const {
    exceptions,
    isLoading,
    refresh,
  } = useExceptions({ category: tab, limit: 100 });

  const { investigate, resolve } = useExceptionActions(() => {
    refresh();
    refreshCounts();
  });

  // Trigger scan
  const [scanning, setScanning] = useState(false);
  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/exceptions/scan", { method: "POST" });
      if (!res.ok) throw new Error("Scan failed");
      const data = await res.json();
      alert(`Scan complete: ${data.detected} detected, ${data.autoResolved} auto-resolved (${data.durationMs}ms)`);
      refresh();
      refreshCounts();
    } catch {
      alert("Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  // Group exceptions by type
  const grouped: Record<string, typeof exceptions> = {};
  for (const ex of exceptions) {
    if (!grouped[ex.type]) grouped[ex.type] = [];
    grouped[ex.type].push(ex);
  }

  const typeOrder = tab === "shipment"
    ? SHIPMENT_TYPES
    : (["PRODUCTION_DELAY"] as const);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{tExceptions("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {counts ? `${counts.totalOpen} ${tExceptions("openExceptions")}` : tCommon("loading")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{scanning ? tExceptions("scanning") : tExceptions("runScan")}</span>
          </Button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto">
        <Button
          size="sm"
          variant={tab === "shipment" ? "default" : "outline"}
          onClick={() => setTab("shipment")}
        >
          <PackageX className="h-4 w-4" />
          {tExceptions("shipmentIssues")}
          {counts && counts.shipmentIssues > 0 && (
            <span className="ml-1.5 bg-white/20 rounded-full px-1.5 text-xs">
              {counts.shipmentIssues}
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant={tab === "processing" ? "default" : "outline"}
          onClick={() => setTab("processing")}
        >
          <Clock className="h-4 w-4" />
          {tExceptions("processingDelays")}
          {counts && counts.processingDelays > 0 && (
            <span className="ml-1.5 bg-white/20 rounded-full px-1.5 text-xs">
              {counts.processingDelays}
            </span>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          {tCommon("loading")}
        </div>
      ) : exceptions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {tab === "shipment" ? tExceptions("noShipmentIssues") : tExceptions("noProcessingDelays")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {typeOrder.map((type) => {
            const items = grouped[type] || [];
            if (items.length === 0) return null;

            const Icon = TYPE_ICONS[type] || AlertTriangle;
            const color = EXCEPTION_TYPE_COLORS[type] || {
              bg: "bg-gray-100",
              text: "text-gray-700",
            };
            const typeLabel = tException.has(`type.${type}`) ? tException(`type.${type}`) : type;

            return (
              <div key={type}>
                <div
                  className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg ${color.bg} border`}
                >
                  <Icon className={`h-4 w-4 ${color.text}`} />
                  <h2 className={`text-sm font-semibold ${color.text}`}>
                    {typeLabel} ({items.length})
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((ex) => (
                    <ExceptionCard
                      key={ex.id}
                      exception={ex}
                      onInvestigate={investigate}
                      onResolve={resolve}
                      onEmailSent={() => { refresh(); refreshCounts(); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
