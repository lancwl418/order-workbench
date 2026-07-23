"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import type { GiftImportAddress } from "@/lib/gift-orders/customer-import";

export type EditableGiftOrder = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: GiftImportAddress;
};

type GiftOrderForm = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  first_name: string;
  last_name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province_code: string;
  zip: string;
  country_code: string;
};

const emptyForm: GiftOrderForm = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  first_name: "",
  last_name: "",
  company: "",
  address1: "",
  address2: "",
  city: "",
  province_code: "",
  zip: "",
  country_code: "US",
};

function formFromOrder(order: EditableGiftOrder): GiftOrderForm {
  const address = order.shippingAddress;
  return {
    customerName: order.customerName,
    customerEmail: order.customerEmail ?? "",
    customerPhone: order.customerPhone ?? "",
    first_name: address.first_name ?? "",
    last_name: address.last_name ?? "",
    company: address.company ?? "",
    address1: address.address1,
    address2: address.address2 ?? "",
    city: address.city,
    province_code: address.province_code,
    zip: address.zip,
    country_code: address.country_code,
  };
}

export function GiftOrderEditDialog({
  order,
  open,
  onOpenChange,
  onSuccess,
}: {
  order: EditableGiftOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("giftOrders");
  const [form, setForm] = useState<GiftOrderForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && order) setForm(formFromOrder(order));
  }, [open, order]);

  function update(field: keyof GiftOrderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!order) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/gift-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.customerName,
          customerEmail: form.customerEmail || null,
          customerPhone: form.customerPhone || null,
          shippingAddress: {
            first_name: form.first_name,
            last_name: form.last_name,
            company: form.company,
            address1: form.address1,
            address2: form.address2,
            city: form.city,
            province_code: form.province_code,
            zip: form.zip,
            country_code: form.country_code.toUpperCase(),
            phone: form.customerPhone,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("orderSaveFailed"));

      onOpenChange(false);
      onSuccess();
      toast.success(t("orderSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("orderSaveFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{
    key: keyof GiftOrderForm;
    label: string;
    required?: boolean;
    type?: string;
    span?: boolean;
    maxLength?: number;
  }> = [
    {
      key: "customerName",
      label: t("orderFields.customerName"),
      required: true,
      span: true,
    },
    { key: "customerEmail", label: t("orderFields.email"), type: "email" },
    { key: "customerPhone", label: t("orderFields.phone"), type: "tel" },
    { key: "first_name", label: t("orderFields.firstName") },
    { key: "last_name", label: t("orderFields.lastName") },
    { key: "company", label: t("orderFields.company"), span: true },
    {
      key: "address1",
      label: t("orderFields.address1"),
      required: true,
      span: true,
    },
    { key: "address2", label: t("orderFields.address2"), span: true },
    { key: "city", label: t("orderFields.city"), required: true },
    {
      key: "province_code",
      label: t("orderFields.state"),
      required: true,
    },
    { key: "zip", label: t("orderFields.zip"), required: true },
    {
      key: "country_code",
      label: t("orderFields.country"),
      required: true,
      maxLength: 2,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{t("editOrderTitle")}</DialogTitle>
            <DialogDescription>
              {t("editOrderDescription", {
                customer: order?.customerName ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div
                key={field.key}
                className={field.span ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}
              >
                <Label htmlFor={`gift-order-${field.key}`}>{field.label}</Label>
                <Input
                  id={`gift-order-${field.key}`}
                  type={field.type ?? "text"}
                  required={field.required}
                  maxLength={field.maxLength}
                  disabled={saving}
                  value={form[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !order}>
              {saving && <Loader2 className="animate-spin" />}
              {t("saveOrder")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
