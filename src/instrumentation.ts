// Next.js instrumentation hook — runs once when the server boots.
// Schedules the supplier status sync (catches factory rejections, 反审回电商)
// so no external cron job is needed. Terminal orders (shipped/closed/
// refunded) are already excluded by syncSupplierStatuses.

const DEFAULT_INTERVAL_MINUTES = 120;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SUPPLIER_STATUS_SYNC_DISABLED === "1") return;

  // Survive hot reloads in dev without stacking timers
  const g = globalThis as typeof globalThis & { __supplierStatusSyncTimer?: NodeJS.Timeout };
  if (g.__supplierStatusSyncTimer) return;

  const intervalMinutes =
    Number(process.env.SUPPLIER_STATUS_SYNC_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;

  const run = async () => {
    try {
      const { syncSupplierStatuses } = await import("@/lib/suppliers/push-service");
      const result = await syncSupplierStatuses();
      if (result.checked > 0 || result.errors.length > 0) {
        console.log(
          `[supplier-status-sync] checked=${result.checked} updated=${result.updated} rejected=${result.rejected}` +
            (result.errors.length ? ` errors=${JSON.stringify(result.errors)}` : "")
        );
      }
    } catch (e) {
      console.error("[supplier-status-sync] failed:", e);
    }
  };

  g.__supplierStatusSyncTimer = setInterval(run, intervalMinutes * 60 * 1000);
  // First pass shortly after boot so a fresh deploy catches up quickly
  setTimeout(run, 60 * 1000);

  console.log(`[supplier-status-sync] scheduled every ${intervalMinutes} minutes`);
}
