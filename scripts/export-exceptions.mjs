#!/usr/bin/env node
/**
 * Export all order exceptions (including resolved/auto-resolved history) to CSV.
 *
 * Usage:
 *   node scripts/export-exceptions.mjs [output.csv]
 *
 * Reads DATABASE_URL / DIRECT_URL from .env. Output defaults to
 * exceptions-export-<date>.csv in the project root. The file is UTF-8 with
 * BOM so Excel renders Chinese characters correctly.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const exceptions = await prisma.orderException.findMany({
    orderBy: { detectedAt: "asc" },
    include: {
      order: {
        select: {
          shopifyOrderNumber: true,
          customerName: true,
          customerEmail: true,
          internalStatus: true,
          totalPrice: true,
        },
      },
      shipment: {
        select: { trackingNumber: true, carrier: true, status: true, shippedAt: true },
      },
      response: {
        select: {
          responseType: true,
          needByDate: true,
          noRush: true,
          comments: true,
          respondedAt: true,
        },
      },
    },
  });

  const header = [
    "exception_id",
    "order_number",
    "customer_name",
    "customer_email",
    "order_status",
    "total_price",
    "exception_type",
    "severity",
    "exception_status",
    "detected_at",
    "resolved_at",
    "tracking_number",
    "carrier",
    "shipment_status",
    "shipped_at",
    "customer_response",
    "response_need_by",
    "response_no_rush",
    "response_comments",
    "responded_at",
  ];

  // Business rules:
  // - Orders already PICKED_UP don't count as exceptions → dropped (counted only).
  // - GFU tracking numbers or carriers other than USPS/UPS/FedEx are likely
  //   not real exceptions → exported to a separate "-other-carriers" file.
  const MAIN_CARRIERS = new Set(["USPS", "UPS", "FEDEX"]);
  const normalizeCarrier = (c) => (c || "").replace(/[^a-z]/gi, "").toUpperCase();

  const pickedUp = [];
  const otherCarrier = [];
  const main = [];
  for (const ex of exceptions) {
    if (ex.order?.internalStatus === "PICKED_UP") {
      pickedUp.push(ex);
    } else if (
      ex.shipment &&
      (/^GFU/i.test(ex.shipment.trackingNumber || "") ||
        !MAIN_CARRIERS.has(normalizeCarrier(ex.shipment.carrier)))
    ) {
      otherCarrier.push(ex);
    } else {
      main.push(ex);
    }
  }

  const toRows = (list) => list.map((ex) =>
    [
      ex.id,
      ex.order?.shopifyOrderNumber,
      ex.order?.customerName,
      ex.order?.customerEmail,
      ex.order?.internalStatus,
      ex.order?.totalPrice,
      ex.type,
      ex.severity,
      ex.status,
      ex.detectedAt,
      ex.resolvedAt,
      ex.shipment?.trackingNumber,
      ex.shipment?.carrier,
      ex.shipment?.status,
      ex.shipment?.shippedAt,
      ex.response?.responseType,
      ex.response?.needByDate,
      ex.response?.noRush,
      ex.response?.comments,
      ex.response?.respondedAt,
    ]
      .map(csvCell)
      .join(",")
  );

  const date = new Date().toISOString().slice(0, 10);
  const outPath = process.argv[2] || `exceptions-export-${date}.csv`;
  const otherPath = outPath.replace(/\.csv$/, "") + "-other-carriers.csv";

  const writeCsv = (path, list) =>
    writeFileSync(path, "\uFEFF" + [header.join(","), ...toRows(list)].join("\n"));
  writeCsv(outPath, main);
  writeCsv(otherPath, otherCarrier);

  const summarize = (list) => {
    const byStatus = {};
    for (const ex of list) byStatus[ex.status] = (byStatus[ex.status] || 0) + 1;
    return Object.entries(byStatus).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  };
  console.log(`Main export: ${main.length} \u2192 ${outPath}`);
  console.log(summarize(main));
  console.log(`Other carriers (GFU / non USPS-UPS-FedEx): ${otherCarrier.length} \u2192 ${otherPath}`);
  console.log(summarize(otherCarrier));
  console.log(`Dropped (order status PICKED_UP): ${pickedUp.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
