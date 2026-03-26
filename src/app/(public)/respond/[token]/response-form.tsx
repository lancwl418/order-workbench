"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Package,
  DollarSign,
  MessageCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

type Option = "RESHIP" | "REFUND" | "CONTACT_SUPPORT";

const OPTIONS: {
  value: Option;
  param: string;
  label: string;
  description: string;
  icon: typeof Package;
  color: string;
  selectedBg: string;
}[] = [
  {
    value: "RESHIP",
    param: "reship",
    label: "Reship My Order",
    description: "We'll send you a new package as soon as possible.",
    icon: Package,
    color: "text-blue-600",
    selectedBg: "border-blue-500 bg-blue-50",
  },
  {
    value: "REFUND",
    param: "refund",
    label: "Request a Refund",
    description: "We'll process a full refund to your original payment method.",
    icon: DollarSign,
    color: "text-green-600",
    selectedBg: "border-green-500 bg-green-50",
  },
  {
    value: "CONTACT_SUPPORT",
    param: "contact",
    label: "Contact Support",
    description: "A support agent will reach out to you directly.",
    icon: MessageCircle,
    color: "text-purple-600",
    selectedBg: "border-purple-500 bg-purple-50",
  },
];

export function ResponseForm({
  token,
  orderNumber,
  customerName,
  exceptionType,
  alreadyResponded,
  existingResponse,
}: {
  token: string;
  orderNumber: string;
  customerName: string;
  exceptionType: string;
  alreadyResponded: boolean;
  existingResponse?: {
    responseType: string;
    needByDate: string | null;
    noRush: boolean;
    comments: string | null;
  };
}) {
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Option | null>(null);
  const [needByDate, setNeedByDate] = useState("");
  const [noRush, setNoRush] = useState(false);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(alreadyResponded);

  // Pre-select from ?option= query param
  useEffect(() => {
    const opt = searchParams.get("option");
    if (opt) {
      const match = OPTIONS.find((o) => o.param === opt);
      if (match) setSelected(match.value);
    }
  }, [searchParams]);

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseType: selected,
          needByDate: selected === "RESHIP" && needByDate ? needByDate : undefined,
          noRush: selected === "RESHIP" ? noRush : undefined,
          comments: comments || undefined,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Already responded or just submitted — show thank you
  if (submitted) {
    const responseType = existingResponse?.responseType || selected;
    const option = OPTIONS.find((o) => o.value === responseType);
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
          <h1 className="text-xl font-semibold">Thank You!</h1>
          <p className="text-muted-foreground">
            We&apos;ve received your response for order <strong>#{orderNumber}</strong>.
          </p>
          {option && (
            <p className="text-sm text-muted-foreground">
              You selected: <strong>{option.label}</strong>
            </p>
          )}
          {existingResponse?.comments && (
            <p className="text-sm text-muted-foreground italic">
              &ldquo;{existingResponse.comments}&rdquo;
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Our team will follow up with you shortly. You can close this page.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-8 pb-6 px-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold">
            Hi {customerName}
          </h1>
          <p className="text-sm text-muted-foreground">
            We&apos;re sorry about the issue with your order <strong>#{orderNumber}</strong>.
            <br />
            Please let us know how you&apos;d like us to resolve this.
          </p>
        </div>

        {/* Option cards */}
        <div className="space-y-3">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelected(opt.value)}
                className={`w-full flex items-start gap-4 p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? opt.selectedBg
                    : "border-border hover:border-muted-foreground/30"
                }`}
              >
                <div
                  className={`mt-0.5 p-2 rounded-full ${
                    isSelected ? opt.selectedBg : "bg-muted"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isSelected ? opt.color : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className={`font-medium ${isSelected ? opt.color : ""}`}>
                    {opt.label}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {opt.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Reship options */}
        {selected === "RESHIP" && (
          <div className="space-y-3 pl-1">
            <p className="text-sm font-medium">
              When do you need it by? <span className="text-muted-foreground font-normal">(optional)</span>
            </p>
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={needByDate}
                onChange={(e) => {
                  setNeedByDate(e.target.value);
                  if (e.target.value) setNoRush(false);
                }}
                min={new Date().toISOString().split("T")[0]}
                className="border rounded-md px-3 py-2 text-sm"
                disabled={noRush}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={noRush}
                onCheckedChange={(v) => {
                  setNoRush(!!v);
                  if (v) setNeedByDate("");
                }}
              />
              <span className="text-sm">No rush — whenever it&apos;s ready</span>
            </label>
          </div>
        )}

        {/* Comments */}
        <div>
          <p className="text-sm font-medium mb-2">
            Anything else you&apos;d like us to know? <span className="text-muted-foreground font-normal">(optional)</span>
          </p>
          <Textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Type your message here..."
            rows={3}
          />
        </div>

        {/* Submit */}
        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={!selected || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            "Submit Response"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
