import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  createOrder,
  type FactoryCreateOrderParams,
  type FactoryGoodsItem,
  type FactoryImage,
  type FactoryConsignee,
} from "@/lib/factory/client";

const itemMappingSchema = z.object({
  orderItemId: z.string(),
  factorySku: z.string().min(1, "Factory SKU required"),
  sizeCode: z.string().optional(),
  sizeName: z.string().optional(),
  colorCode: z.string().optional(),
  colorName: z.string().optional(),
  styleCode: z.string().optional(),
  styleName: z.string().optional(),
  craftType: z.union([z.literal(1), z.literal(2)]).optional(),
  shouldPrint: z.boolean().default(false),
  printPosition: z.enum(["1", "2", "1,2"]).optional(),
  imageUrls: z.array(z.string().url()).optional(),
});

const pushSchema = z.object({
  craftType: z.union([z.literal(1), z.literal(2)]).default(1),
  platformType: z.union([z.literal(15), z.literal(18)]).default(15),
  sellerRemark: z.string().optional(),
  items: z.array(itemMappingSchema).min(1),
});

function formatOrderTime(d: Date | null | undefined): string {
  const date = d ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildConsignee(shippingAddress: Record<string, unknown> | null | undefined, customerName: string | null): FactoryConsignee | null {
  if (!shippingAddress) return null;
  const a = shippingAddress as Record<string, string | undefined>;
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || customerName || "";
  const phone = a.phone || "";
  const address = a.address1 || "";
  const province = a.province_code || a.province || "";
  const city = a.city || "";
  const country = a.country || a.country_code || "";
  if (!name || !phone || !address || !province || !city || !country) {
    return null;
  }
  return {
    name,
    phone,
    address,
    alternateAddress: a.address2 || undefined,
    country,
    province,
    city,
    postCode: a.zip || a.postal_code || undefined,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const body = await req.json();
  const parsed = pushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { craftType, platformType, sellerRemark, items } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const consignee = buildConsignee(
    order.shippingAddress as Record<string, unknown> | null,
    order.customerName
  );
  if (!consignee) {
    return NextResponse.json(
      { error: "Order shipping address is incomplete — need name, phone, address, city, province, country" },
      { status: 400 }
    );
  }

  if (!order.shopifyOrderNumber) {
    return NextResponse.json(
      { error: "Order is missing Shopify order number — cannot use as pfOrderId" },
      { status: 400 }
    );
  }

  const itemById = new Map(order.orderItems.map((i) => [i.id, i]));
  for (const m of items) {
    if (!itemById.has(m.orderItemId)) {
      return NextResponse.json(
        { error: `Item ${m.orderItemId} does not belong to this order` },
        { status: 400 }
      );
    }
  }

  const pfOrderId = order.shopifyOrderNumber;
  const sourceOrderId = order.id;

  const goodsList: FactoryGoodsItem[] = items.map((m, idx) => {
    const item = itemById.get(m.orderItemId)!;
    const resolvedCraftType = (m.craftType ?? craftType) as 1 | 2;

    let imageList: FactoryImage[] = [];
    let printPosition: string | undefined;
    if (m.shouldPrint) {
      printPosition = m.printPosition;
      const urls = m.imageUrls && m.imageUrls.length > 0
        ? m.imageUrls
        : item.designFileUrl
          ? [item.designFileUrl]
          : [];
      imageList = urls.map((url, i) => ({
        type: 1 as const,
        imageUrl: url,
        imageCode: `${item.id}-print-${i}`,
        imageName: `${item.id}-print-${i}`,
      }));
    }

    return {
      pfOrderId,
      pfSubOrderId: `${pfOrderId}-${idx + 1}`,
      goodsType: 1,
      title: item.title,
      specification: m.factorySku,
      subOrderStatus: "NOT_SHIPPED",
      subOrderRefundStatus: "NO_REFUND",
      sizeCode: m.sizeCode || "",
      sizeName: m.sizeName || m.sizeCode || "",
      colorCode: m.colorCode || "",
      colorName: m.colorName || m.colorCode || "",
      styleCode: m.styleCode || m.factorySku,
      styleName: m.styleName || m.styleCode || m.factorySku,
      craftType: resolvedCraftType,
      num: item.quantity,
      spuId: item.sku || undefined,
      skuId: m.factorySku,
      price: Number(item.price),
      sellPrice: Number(item.price),
      printPosition,
      imageList,
    };
  });

  const payload: FactoryCreateOrderParams = {
    platformType,
    sourceOrderId,
    pfOrderStatus: "NOT_SHIPPED",
    pfRefundStatus: "NO_REFUND",
    pfOrderId,
    consignee,
    orderTime: formatOrderTime(order.shopifyCreatedAt ?? order.createdAt),
    postCode: consignee.postCode,
    goodsList,
    sellerRemark,
  };

  let traceId: string | undefined;
  try {
    const result = await createOrder(payload);
    traceId = result.traceId;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to push to factory";
    const errTraceId = (e as Error & { traceId?: string }).traceId;
    const errorCode = (e as Error & { errorCode?: string }).errorCode;
    await prisma.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "factory_push_failed",
        message: message.slice(0, 500),
        metadata: { traceId: errTraceId, errorCode, payload: JSON.parse(JSON.stringify(payload)) },
      },
    });
    return NextResponse.json({ error: message, traceId: errTraceId, errorCode }, { status: 502 });
  }

  // Persist per-item factory fields + upsert SkuMapping records
  await prisma.$transaction(async (tx) => {
    for (const m of items) {
      const item = itemById.get(m.orderItemId)!;
      const resolvedCraftType = (m.craftType ?? craftType) as 1 | 2;
      await tx.orderItem.update({
        where: { id: m.orderItemId },
        data: {
          factorySku: m.factorySku,
          factorySize: m.sizeCode || null,
          factoryColor: m.colorCode || null,
          factoryStyle: m.styleCode || null,
          factoryCraftType: resolvedCraftType,
        },
      });
      if (item.sku) {
        await tx.skuMapping.upsert({
          where: {
            ourSku_variantTitle: {
              ourSku: item.sku,
              variantTitle: item.variantTitle ?? "",
            },
          },
          update: {
            factorySku: m.factorySku,
            factorySize: m.sizeCode || null,
            factoryColor: m.colorCode || null,
            factoryStyle: m.styleCode || null,
            factoryCraftType: resolvedCraftType,
            lastUsedAt: new Date(),
          },
          create: {
            ourSku: item.sku,
            variantTitle: item.variantTitle ?? "",
            factorySku: m.factorySku,
            factorySize: m.sizeCode || null,
            factoryColor: m.colorCode || null,
            factoryStyle: m.styleCode || null,
            factoryCraftType: resolvedCraftType,
          },
        });
      }
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        factoryPushedAt: new Date(),
        factoryLastTraceId: traceId ?? null,
        factoryPushCount: { increment: 1 },
      },
    });

    await tx.orderLog.create({
      data: {
        orderId,
        userId: session.user?.id,
        action: "factory_pushed",
        message: `Pushed ${items.length} item(s) to factory | trace ${traceId ?? "-"}`,
        metadata: {
          traceId,
          itemIds: items.map((m) => m.orderItemId),
        },
      },
    });
  });

  return NextResponse.json({ success: true, traceId });
}
