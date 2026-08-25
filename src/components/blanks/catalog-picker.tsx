"use client";

import { useEffect, useMemo, useRef } from "react";
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
  factorySku,
  onPick,
}: {
  supplierId: string;
  styleCode: string;
  colorCode: string;
  sizeCode: string;
  factorySku: string;
  onPick: (patch: { factorySku?: string; styleCode?: string; colorCode?: string; sizeCode?: string }) => void;
}) {
  const t = useTranslations("blanks");
  const { data } = useSupplierCatalog(supplierId);

  // Only an explicit styleCode match selects a style — never default to the
  // catalog's single style (it may be a different product entirely, e.g. a
  // tote bag when the catalog only has the A2 tee so far).
  const styles = data?.styles ?? [];
  const style = useMemo(() => styles.find((s) => s.styleCode === styleCode), [styles, styleCode]);
  const color = style?.colors.find((c) => c.colorName === colorCode);

  // Auto-match once per supplier: when the code is empty (fresh supplier
  // switch without a stored mapping), match the current color/size against
  // the catalog case-insensitively and fill the exact factory code.
  const matchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (matchedFor.current === supplierId) return;
    if (!data || styles.length === 0) return;
    matchedFor.current = supplierId;
    const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, "");

    // 1) Exact product-code match: our SKUs often ARE the factory catalog
    //    code (T001-BK01-L). Align style/color/size to the catalog entry so
    //    the color field carries the factory's color code (BK01, not Black)
    //    and the composed factory code never duplicates.
    if (factorySku.trim()) {
      for (const s of styles) {
        for (const c of s.colors) {
          const entry = c.sizes.find((z) => norm(z.productCode) === norm(factorySku));
          if (entry) {
            if (styleCode !== s.styleCode || colorCode !== c.colorName || sizeCode !== entry.sizeName) {
              onPick({
                styleCode: s.styleCode,
                colorCode: c.colorName,
                sizeCode: entry.sizeName,
                factorySku: entry.productCode,
              });
            }
            return;
          }
        }
      }
      return;
    }

    // 2) Color+size match (single style only) — a real product match, not a
    //    guess, used after a supplier switch cleared the code.
    const s = style ?? (styles.length === 1 ? styles[0] : undefined);
    if (!s) return;
    const c = s.colors.find((c0) => colorCode && norm(c0.colorName) === norm(colorCode));
    if (!c) return;
    const size = c.sizes.find((z) => sizeCode && norm(z.sizeName) === norm(sizeCode));
    if (!size) return;
    onPick({
      styleCode: s.styleCode,
      colorCode: c.colorName,
      sizeCode: size.sizeName,
      factorySku: size.productCode,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, supplierId]);

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
