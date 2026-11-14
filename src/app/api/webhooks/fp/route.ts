import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdapter } from "@/lib/suppliers/registry";
import { syncSupplierStatuses } from "@/lib/suppliers/push-service";
import { FpAdapter } from "@/lib/suppliers/fp";

// FP ERP webhook receiver (configure this URL on the FP store):
//   {APP_URL}/api/webhooks/fp
//
// FP notifies on async order-creation results, order/logistics status
// changes, and label requests for own-label (logisticsType=1) orders.
// The payload is treated as an untrusted TRIGGER only — statuses are never
// written from the webhook body; we re-query FP through the signed API
// (syncSupplierStatuses), which makes the endpoint naturally idempotent
// (FP retries deliveries) and safe without a webhook signature.

export const dynamic = "force-dynamic";

/** Collect platformOid-looking values from an arbitrary payload. */
function extractPlatformOids(payload: unknown): string[] {
  const oids = new Set<string>();
  const visit = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v === "object") {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (/platformOid/i.test(key) && typeof val === "string" && val.trim()) {
          oids.add(val.trim());
        } else {
          visit(val);
        }
      }
    }
  };
  visit(payload);
  return [...oids];
}

/** Whether the event looks like FP asking for the shipping label. */
function looksLikeLabelRequest(payload: unknown): boolean {
  return /label|waybill|面单/i.test(JSON.stringify(payload ?? ""));
}

async function maybeUploadLabel(platformOid: string): Promise<string | null> {
  const push = await prisma.supplierPush.findUnique({
    where: { platformOid },
    include: { supplier: true },
  });
  if (!push || push.supplier.adapterType !== "fp") return null;
  const payload = push.requestPayload as { fpLogisticsType?: number } | null;
  if (payload?.fpLogisticsType !== 1) return null;

  const shipment = await prisma.shipment.findFirst({
    where: { orderId: push.orderId, labelUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!shipment?.labelUrl) return `no label on order yet for ${platformOid}`;

  const adapter = getAdapter(push.supplier);
  if (!(adapter instanceof FpAdapter)) return null;
  await adapter.uploadShippingLabel({
    platformOid,
    labelUrl: shipment.labelUrl,
    trackingNumber: shipment.trackingNumber ?? undefined,
    carrier: shipment.carrier ?? undefined,
  });
  await prisma.orderLog.create({
    data: {
      orderId: push.orderId,
      action: "blanks_label_uploaded",
      message: `${push.supplier.name}: shipping label uploaded to FP for ${platformOid}`,
      metadata: { platformOid, shipmentId: shipment.id },
    },
  });
  return null;
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const oids = extractPlatformOids(payload);
  const pushes = oids.length
    ? await prisma.supplierPush.findMany({
        where: { platformOid: { in: oids } },
        select: { orderId: true, platformOid: true },
      })
    : [];

  // Log the event on each matched order so the trail survives even when the
  // payload shape is unexpected.
  const snippet = JSON.stringify(payload).slice(0, 1500);
  for (const p of pushes) {
    await prisma.orderLog.create({
      data: {
        orderId: p.orderId,
        action: "fp_webhook",
        message: `FP webhook for ${p.platformOid}`,
        metadata: { payload: snippet },
      },
    });
  }

  // Re-pull the truth from FP per affected order (never trust the body).
  const orderIds = [...new Set(pushes.map((p) => p.orderId))];
  const errors: string[] = [];
  for (const orderId of orderIds) {
    try {
      await syncSupplierStatuses({ orderId });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "sync failed");
    }
  }

  // Own-label orders: FP may be asking for the label — upload when we have it.
  if (looksLikeLabelRequest(payload)) {
    for (const oid of oids) {
      try {
        const problem = await maybeUploadLabel(oid);
        if (problem) errors.push(problem);
      } catch (e) {
        errors.push(`label upload ${oid}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  // Always 200 so FP doesn't retry storms on our internal errors; problems
  // are visible in the order log / response body.
  return NextResponse.json({
    received: true,
    matched: pushes.length,
    ...(errors.length ? { errors } : {}),
  });
}
