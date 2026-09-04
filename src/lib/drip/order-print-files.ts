import {
  resolveGangSheetUrls,
  isDirectImageUrl,
  type ResolvedPrintFile,
} from "./resolve-gang-sheet";

/** The subset of OrderItem the resolver needs. */
export interface PrintFileItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  itemType: string;
  designFileUrl: string | null;
  originalDesignFileUrl: string | null;
}

/** One design URL shared by one or more order items. */
export interface PrintFileSource {
  url: string;
  label: string;
  itemIds: string[];
  originalUrl: string | null;
  /**
   * How many copies of the sheet to print. Ready to Print gang sheets are
   * sold per sheet, so quantity 3 = three copies of the same image; every
   * other source is a single file (or a Drip page that lists its own files).
   */
  copies: number;
}

/**
 * Group order items by designFileUrl (every route that lists print files
 * did this by hand — keep one copy of the rule). Ready to Print items add
 * their quantity as copies of the shared image.
 */
export function groupPrintFileSources(items: PrintFileItem[]): PrintFileSource[] {
  const byUrl = new Map<string, PrintFileSource & { readyCopies: number }>();
  for (const item of items) {
    if (!item.designFileUrl) continue;
    const isReady = item.itemType === "ready_print";
    const existing = byUrl.get(item.designFileUrl);
    if (existing) {
      existing.itemIds.push(item.id);
      if (isReady) existing.readyCopies += item.quantity;
    } else {
      byUrl.set(item.designFileUrl, {
        url: item.designFileUrl,
        label: item.variantTitle || item.title,
        itemIds: [item.id],
        originalUrl: item.originalDesignFileUrl,
        copies: 1,
        readyCopies: isReady ? item.quantity : 0,
      });
    }
  }
  return [...byUrl.values()].map(({ readyCopies, ...src }) => ({
    ...src,
    copies: Math.max(1, readyCopies),
  }));
}

/**
 * Resolve one source URL to downloadable files.
 * - Ready to Print (copies > 1) and direct images → the URL itself, named
 *   `{order}-{label}.png`, repeated once per copy as `-{i} of {n}`.
 * - Transfer by Size page URLs → the gang sheets listed on the page.
 */
export async function resolvePrintFileSource(
  url: string,
  opts: { orderNum: string; label: string; copies?: number }
): Promise<ResolvedPrintFile[]> {
  const copies = Math.max(1, opts.copies ?? 1);
  if (copies === 1 && !isDirectImageUrl(url)) {
    return resolveGangSheetUrls(url);
  }
  const base = `${opts.orderNum}-${opts.label}`;
  if (copies === 1) return [{ url, filename: `${base}.png` }];
  return Array.from({ length: copies }, (_, i) => ({
    url,
    filename: `${base}-${i + 1} of ${copies}.png`,
  }));
}

/**
 * Resolve every print file for an order: grouped item sources plus the
 * order's extra print files (uploads not tied to an item).
 */
export async function resolveOrderPrintFiles(order: {
  shopifyOrderNumber: string | null;
  orderItems: PrintFileItem[];
  extraPrintFiles: unknown;
}): Promise<ResolvedPrintFile[]> {
  const orderNum = order.shopifyOrderNumber?.replace("#", "") || "";
  const files: ResolvedPrintFile[] = [];
  const seen = new Set<string>();

  for (const src of groupPrintFileSources(order.orderItems)) {
    seen.add(src.url);
    files.push(
      ...(await resolvePrintFileSource(src.url, {
        orderNum,
        label: src.label,
        copies: src.copies,
      }))
    );
  }

  // Extra files are operator uploads: already direct images with a chosen name
  for (const extra of extraPrintFilesOf(order.extraPrintFiles)) {
    if (seen.has(extra.url)) continue;
    seen.add(extra.url);
    files.push({ url: extra.url, filename: extra.filename });
  }

  return files;
}

export function extraPrintFilesOf(raw: unknown): { url: string; filename: string }[] {
  return Array.isArray(raw) ? (raw as { url: string; filename: string }[]) : [];
}
