"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSupplierCatalog } from "./use-push-blanks";

// Factory-catalog picker: style → color → size selects fed by the supplier's
// imported catalog. Picking a size fills the exact factory product code, so
// hand-typed (and typo-prone) codes become unnecessary where a catalog exists.

export function CatalogPicker({
  supplierId,
  styleCode,
  colorCode,
  sizeCode,
  onPick,
}: {
  supplierId: string;
  styleCode: string;
  colorCode: string;
  sizeCode: string;
  onPick: (patch: { factorySku?: string; styleCode?: string; colorCode?: string; sizeCode?: string }) => void;
}) {
  const t = useTranslations("blanks");
  const { data } = useSupplierCatalog(supplierId);

  const styles = data?.styles ?? [];
  const style = useMemo(
    () => styles.find((s) => s.styleCode === styleCode) ?? (styles.length === 1 ? styles[0] : undefined),
    [styles, styleCode]
  );
  const color = style?.colors.find((c) => c.colorName === colorCode);

  if (styles.length === 0) return null;

  return (
    <div className="md:col-span-4 grid grid-cols-3 gap-2 border rounded-md bg-muted/30 p-2">
      <div>
        <label className="text-[11px] text-muted-foreground">{t("catalogStyle")}</label>
        <Select
          value={style?.styleCode ?? ""}
          onValueChange={(v) => {
            if (!v) return;
            onPick({ styleCode: v, colorCode: "", sizeCode: "" });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("catalogPick")} />
          </SelectTrigger>
          <SelectContent>
            {styles.map((s) => (
              <SelectItem key={s.styleCode} value={s.styleCode}>
                {s.styleCode}
                {s.styleName ? ` · ${s.styleName}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">{t("catalogColor")}</label>
        <Select
          value={color?.colorName ?? ""}
          onValueChange={(v) => {
            if (!v || !style) return;
            onPick({ styleCode: style.styleCode, colorCode: v, sizeCode: "" });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("catalogPick")} />
          </SelectTrigger>
          <SelectContent>
            {(style?.colors ?? []).map((c) => (
              <SelectItem key={c.colorName} value={c.colorName}>
                {c.colorName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground">{t("catalogSize")}</label>
        <Select
          value={sizeCode && color?.sizes.some((s) => s.sizeName === sizeCode) ? sizeCode : ""}
          onValueChange={(v) => {
            if (!v || !style || !color) return;
            const size = color.sizes.find((s) => s.sizeName === v);
            onPick({
              styleCode: style.styleCode,
              colorCode: color.colorName,
              sizeCode: v,
              factorySku: size?.productCode,
            });
          }}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("catalogPick")} />
          </SelectTrigger>
          <SelectContent>
            {(color?.sizes ?? []).map((s) => (
              <SelectItem key={s.sizeName} value={s.sizeName}>
                {s.sizeName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
