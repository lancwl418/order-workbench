"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Supplier {
  id: string;
  key: string;
  name: string;
  adapterType: string;
  baseUrl: string | null;
  consoleUrl: string | null;
  secretKeyEnv: string;
  platformType: number;
  enabled: boolean;
  secretConfigured: boolean;
  _count: { vendorMappings: number; pushes: number };
}

interface VendorMapping {
  id: string;
  vendor: string;
  supplier: { id: string; key: string; name: string; enabled: boolean };
}

export function BlanksSettingsPage() {
  const t = useTranslations("blanks");
  const suppliersSwr = useSWR<{ suppliers: Supplier[] }>("/api/suppliers", fetcher);
  const mappingsSwr = useSWR<{ mappings: VendorMapping[]; unmappedVendors: string[] }>(
    "/api/vendor-mappings",
    fetcher
  );

  const [newSupplier, setNewSupplier] = useState({
    key: "",
    name: "",
    adapterType: "riin",
    secretKeyEnv: "",
  });
  const [newMapping, setNewMapping] = useState({ vendor: "", supplierId: "" });
  const [consoleDrafts, setConsoleDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const suppliers = suppliersSwr.data?.suppliers ?? [];
  const mappings = mappingsSwr.data?.mappings ?? [];
  const unmappedVendors = mappingsSwr.data?.unmappedVendors ?? [];

  async function createSupplier() {
    if (!newSupplier.key || !newSupplier.name || !newSupplier.secretKeyEnv) {
      toast.error(t("supplierCreateMissing"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSupplier),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("createFailed"));
      toast.success(t("supplierCreated", { name: data.supplier.name }));
      setNewSupplier({ key: "", name: "", adapterType: "riin", secretKeyEnv: "" });
      suppliersSwr.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSupplier(s: Supplier) {
    const res = await fetch(`/api/suppliers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    if (res.ok) {
      suppliersSwr.mutate();
    } else {
      toast.error(t("updateFailed"));
    }
  }

  async function saveConsoleUrl(s: Supplier) {
    const value = (consoleDrafts[s.id] ?? s.consoleUrl ?? "").trim();
    const res = await fetch(`/api/suppliers/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consoleUrl: value || null }),
    });
    if (res.ok) {
      toast.success(t("consoleSaved", { name: s.name }));
      suppliersSwr.mutate();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || t("saveFailed"));
    }
  }

  async function createMapping(vendor?: string) {
    const v = (vendor ?? newMapping.vendor).trim();
    const supplierId = newMapping.supplierId;
    if (!v || !supplierId) {
      toast.error(t("mappingMissing"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vendor-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: v, supplierId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("saveFailed"));
      toast.success(t("mappingSaved", { vendor: data.mapping.vendor, name: data.mapping.supplier.name }));
      setNewMapping((m) => ({ ...m, vendor: "" }));
      mappingsSwr.mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteMapping(id: string) {
    const res = await fetch(`/api/vendor-mappings/${id}`, { method: "DELETE" });
    if (res.ok) {
      mappingsSwr.mutate();
    } else {
      toast.error(t("deleteFailed"));
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <Link href="/blanks">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">{t("settingsTitle")}</h1>
      </div>

      {/* Suppliers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("suppliersCard")}</CardTitle>
          <CardDescription>
            {t("suppliersDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colKey")}</TableHead>
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colProtocol")}</TableHead>
                <TableHead>{t("colSecretEnv")}</TableHead>
                <TableHead>{t("colConsole")}</TableHead>
                <TableHead>{t("colMappingCount")}</TableHead>
                <TableHead>{t("colEnabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.key}</TableCell>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {s.adapterType}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.secretKeyEnv}{" "}
                    {s.secretConfigured ? (
                      <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">
                        {t("secretConfigured")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-red-300 text-red-700">
                        {t("secretMissing")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        value={consoleDrafts[s.id] ?? s.consoleUrl ?? ""}
                        onChange={(e) =>
                          setConsoleDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                        }
                        placeholder="https://…"
                        className="h-7 text-xs w-44"
                      />
                      {consoleDrafts[s.id] !== undefined &&
                        consoleDrafts[s.id] !== (s.consoleUrl ?? "") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2"
                            onClick={() => saveConsoleUrl(s)}
                          >
                            {t("save")}
                          </Button>
                        )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{s._count.vendorMappings}</TableCell>
                  <TableCell>
                    <Checkbox checked={s.enabled} onCheckedChange={() => toggleSupplier(s)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end border-t pt-3">
            <div>
              <label className="text-[11px] text-muted-foreground">{t("newKeyLabel")}</label>
              <Input
                value={newSupplier.key}
                onChange={(e) => setNewSupplier((s) => ({ ...s, key: e.target.value }))}
                placeholder="factory-x"
                className="h-8 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{t("newNameLabel")}</label>
              <Input
                value={newSupplier.name}
                onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
                placeholder="Factory X"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{t("newProtocolLabel")}</label>
              <Select
                value={newSupplier.adapterType}
                onValueChange={(v) => setNewSupplier((s) => ({ ...s, adapterType: v ?? "riin" }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="riin">riin</SelectItem>
                  <SelectItem value="linmiao">linmiao</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">{t("newSecretEnvLabel")}</label>
              <Input
                value={newSupplier.secretKeyEnv}
                onChange={(e) =>
                  setNewSupplier((s) => ({ ...s, secretKeyEnv: e.target.value.toUpperCase() }))
                }
                placeholder="RIIN_FACTORYX_SECRET_KEY"
                className="h-8 text-sm font-mono"
              />
            </div>
            <Button size="sm" onClick={createSupplier} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              {t("add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Vendor mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("mappingsCard")}</CardTitle>
          <CardDescription>
            {t("mappingsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {unmappedVendors.length > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
              <span className="font-medium text-amber-800">
                {t("unmappedHint")}
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {unmappedVendors.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="px-1.5 py-0.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-100"
                    onClick={() => setNewMapping((m) => ({ ...m, vendor: v }))}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colVendor")}</TableHead>
                <TableHead>{t("colSupplier")}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.vendor}</TableCell>
                  <TableCell className="text-sm">
                    {m.supplier.name}
                    {!m.supplier.enabled && (
                      <Badge variant="outline" className="ml-1.5 text-[10px] border-red-300 text-red-700">
                        {t("supplierDisabled")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => deleteMapping(m.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {mappings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-6">
                    {t("noMappings")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="flex items-end gap-2 border-t pt-3">
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground">{t("colVendor")}</label>
              <Input
                value={newMapping.vendor}
                onChange={(e) => setNewMapping((m) => ({ ...m, vendor: e.target.value }))}
                placeholder="jjspromo"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground">{t("colSupplier")}</label>
              <Select
                value={newMapping.supplierId}
                onValueChange={(v) => setNewMapping((m) => ({ ...m, supplierId: v ?? "" }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder={t("selectSupplier")} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.filter((s) => s.enabled).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => createMapping()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              {t("add")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
