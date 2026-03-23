"use client";

import { useState, useCallback, useRef } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import type { PaginatedResponse, PurchaseOrder } from "@/types";
import {
  Plus,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Upload,
  X,
  Paperclip,
  Trash2,
  Search,
} from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const PO_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: "bg-gray-100", text: "text-gray-700" },
  CONFIRMED: { bg: "bg-blue-100", text: "text-blue-700" },
  RECEIVED: { bg: "bg-emerald-100", text: "text-emerald-700" },
  CANCELLED: { bg: "bg-red-100", text: "text-red-700" },
};

function usePurchaseOrders(page: number, status?: string, search?: string) {
  const params = new URLSearchParams({
    page: String(page),
    limit: "25",
    sort: "createdAt",
    dir: "desc",
  });
  if (status) params.set("status", status);
  if (search) params.set("search", search);

  const { data, isLoading, error, mutate } = useSWR<
    PaginatedResponse<PurchaseOrder>
  >(`/api/purchase-orders?${params.toString()}`, fetcher, {
    keepPreviousData: true,
  });

  return {
    orders: data?.data || [],
    pagination: data?.pagination,
    isLoading,
    error,
    refresh: mutate,
  };
}

type FormData = {
  poNumber: string;
  supplier: string;
  amount: string;
  currency: string;
  purchaseDate: string;
  note: string;
  attachments: string[];
};

const emptyForm: FormData = {
  poNumber: "",
  supplier: "",
  amount: "",
  currency: "USD",
  purchaseDate: new Date().toISOString().slice(0, 10),
  note: "",
  attachments: [],
};

export default function ProcurementPage() {
  const t = useTranslations("procurement");
  const tCommon = useTranslations("common");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const { orders, pagination, isLoading, refresh } = usePurchaseOrders(
    page,
    statusFilter || undefined,
    searchTerm || undefined
  );

  // Create / Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    po: PurchaseOrder | null;
  }>({ open: false, po: null });
  const [deleting, setDeleting] = useState(false);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((po: PurchaseOrder) => {
    setEditingId(po.id);
    setForm({
      poNumber: po.poNumber,
      supplier: po.supplier,
      amount: String(po.amount),
      currency: po.currency,
      purchaseDate: new Date(po.purchaseDate).toISOString().slice(0, 10),
      note: po.note || "",
      attachments: po.attachments || [],
    });
    setDialogOpen(true);
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/procurement", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const { url } = await res.json();
      setForm((f) => ({ ...f, attachments: [...f.attachments, url] }));
      toast.success(t("fileUploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(idx: number) {
    setForm((f) => ({
      ...f,
      attachments: f.attachments.filter((_, i) => i !== idx),
    }));
  }

  async function handleSave() {
    if (!form.poNumber || !form.supplier || !form.amount) {
      toast.error(t("requiredFields"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        poNumber: form.poNumber,
        supplier: form.supplier,
        amount: parseFloat(form.amount),
        currency: form.currency,
        purchaseDate: form.purchaseDate,
        note: form.note || null,
        attachments: form.attachments,
      };

      const url = editingId
        ? `/api/purchase-orders/${editingId}`
        : "/api/purchase-orders";
      const method = editingId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }

      toast.success(editingId ? t("updated") : t("created"));
      setDialogOpen(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteDialog.po) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/purchase-orders/${deleteDialog.po.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success(t("deleted"));
      setDeleteDialog({ open: false, po: null });
      refresh();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  async function handleStatusChange(po: PurchaseOrder, newStatus: string) {
    try {
      const res = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success(t("statusUpdated"));
      refresh();
    } catch {
      toast.error("Failed to update status");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          {t("create")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v === "ALL" ? "" : v ?? "");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("allStatuses")}</SelectItem>
            <SelectItem value="DRAFT">{t("status.DRAFT")}</SelectItem>
            <SelectItem value="CONFIRMED">{t("status.CONFIRMED")}</SelectItem>
            <SelectItem value="RECEIVED">{t("status.RECEIVED")}</SelectItem>
            <SelectItem value="CANCELLED">{t("status.CANCELLED")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.poNumber")}</TableHead>
              <TableHead>{t("columns.supplier")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("columns.amount")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("columns.purchaseDate")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("columns.attachments")}</TableHead>
              <TableHead>{tCommon("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {tCommon("loading")}
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {tCommon("noData")}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((po) => {
                const colors = PO_STATUS_COLORS[po.status] || PO_STATUS_COLORS.DRAFT;
                return (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNumber}</TableCell>
                    <TableCell>{po.supplier}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {po.currency} {Number(po.amount).toFixed(2)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {formatDate(po.purchaseDate)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${colors.bg} ${colors.text} border-0`}>
                        {t(`status.${po.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {po.attachments?.length || 0}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Select
                          value={po.status}
                          onValueChange={(v) => v && handleStatusChange(po, v)}
                        >
                          <SelectTrigger className="h-8 w-[110px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DRAFT">{t("status.DRAFT")}</SelectItem>
                            <SelectItem value="CONFIRMED">{t("status.CONFIRMED")}</SelectItem>
                            <SelectItem value="RECEIVED">{t("status.RECEIVED")}</SelectItem>
                            <SelectItem value="CANCELLED">{t("status.CANCELLED")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(po)}
                        >
                          {tCommon("edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteDialog({ open: true, po })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between py-4">
          <div className="hidden sm:block text-sm text-muted-foreground">
            {tCommon("showing")} {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)} {tCommon("of")}{" "}
            {pagination.total}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {editingId ? t("editDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">{t("columns.poNumber")}</label>
                <Input
                  value={form.poNumber}
                  onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))}
                  placeholder="PO-001"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("columns.supplier")}</label>
                <Input
                  value={form.supplier}
                  onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                  placeholder={t("supplierPlaceholder")}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium">{t("columns.amount")}</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("currency")}</label>
                <Input
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  placeholder="USD"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("columns.purchaseDate")}</label>
                <Input
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">{t("note")}</label>
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("notePlaceholder")}
              />
            </div>

            {/* Attachments */}
            <div>
              <label className="text-sm font-medium">{t("columns.attachments")}</label>
              <div className="mt-1 space-y-2">
                {form.attachments.map((url, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-primary hover:underline flex-1"
                    >
                      {url.split("/").pop()}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeAttachment(idx)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1" />
                  )}
                  {uploading ? tCommon("uploading") : t("uploadFile")}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {saving ? tCommon("saving") : tCommon("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((d) => ({ ...d, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDelete")}</DialogTitle>
            <DialogDescription>
              {t("confirmDeleteMessage", {
                poNumber: deleteDialog.po?.poNumber || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, po: null })}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {tCommon("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
