import type { Supplier } from "@prisma/client";
import {
  createOrder,
  queryOrderStatus as linmiaoQueryOrderStatus,
  type FactoryCreateOrderParams,
  type FactoryGoodsItem,
  type FactoryImage,
} from "@/lib/factory/client";
import {
  formatOrderTime,
  type SupplierAdapter,
  type SupplierOrderInput,
  type SupplierOrderResult,
  type SupplierOrderStatus,
  type SupplierPushToFactoryResult,
} from "./types";

/**
 * Build the linmiao create-order payload from the unified input. Pure —
 * exported for tests. Non-print items use linmiao's established convention:
 * a type-1 entry with the "[不打印]" marker plus up to two effect images.
 */
export function buildLinmiaoCreateOrderParams(
  input: SupplierOrderInput,
  platformType: number
): FactoryCreateOrderParams {
  const goodsList: FactoryGoodsItem[] = input.items.map((item, idx) => {
    let imageList: FactoryImage[];
    let printPosition: string | undefined;
    if (item.shouldPrint) {
      printPosition = item.printPosition;
      // Image codes must not contain "-", "+", "&" or spaces (OPEN_API doc)
      imageList = item.printImageUrls.map((url, i) => ({
        type: 1 as const,
        imageUrl: url,
        imageCode: `${item.orderItemId}_print_${i}`,
        imageName: `${item.orderItemId}_print_${i}`,
      }));
    } else {
      imageList = [
        { type: 1 as const, imageUrl: "", imageCode: "[不打印]", imageName: "noprint" },
        ...item.effectImageUrls.slice(0, 2).map((url, i) => ({
          type: 2 as const,
          imageUrl: url,
          imageCode: `${item.orderItemId}_effect_${i}`,
          imageName: `${item.orderItemId}_effect_${i}`,
        })),
      ];
    }

    return {
      pfOrderId: input.platformOid,
      pfSubOrderId: `${input.platformOid}-${idx + 1}`,
      goodsType: 1 as const,
      title: item.title,
      specification: item.factorySku,
      subOrderStatus: "NOT_SHIPPED" as const,
      subOrderRefundStatus: "NO_REFUND" as const,
      sizeCode: item.sizeCode,
      sizeName: item.sizeName || item.sizeCode,
      colorCode: item.colorCode,
      colorName: item.colorName || item.colorCode,
      styleCode: item.styleCode || item.factorySku,
      styleName: item.styleName || item.styleCode || item.factorySku,
      craftType: item.craftType,
      num: item.quantity,
      spuId: item.ourSku || undefined,
      skuId: item.factorySku,
      price: item.price,
      sellPrice: item.price,
      printPosition,
      imageList,
    };
  });

  return {
    platformType: platformType as 15 | 18,
    sourceOrderId: input.sourceOrderId,
    pfOrderStatus: "NOT_SHIPPED",
    pfRefundStatus: "NO_REFUND",
    pfOrderId: input.platformOid,
    consignee: {
      name: input.consignee.name,
      phone: input.consignee.phone,
      address: input.consignee.address,
      alternateAddress: input.consignee.addressOptional,
      country: input.consignee.country,
      province: input.consignee.province,
      city: input.consignee.city,
      district: input.consignee.district,
      town: input.consignee.town,
      postCode: input.consignee.postCode,
    },
    orderTime: formatOrderTime(input.orderTime),
    postCode: input.consignee.postCode,
    goodsList,
    sellerRemark: input.sellerRemark,
  };
}

export class LinmiaoAdapter implements SupplierAdapter {
  readonly supplier: Supplier;

  constructor(supplier: Supplier) {
    this.supplier = supplier;
  }

  async placeOrder(
    input: SupplierOrderInput,
    _opts: { push: boolean }
  ): Promise<SupplierOrderResult> {
    // linmiao has no separate push step — creating the order sends it to the
    // factory, so a "place only" request still results in pushed=true.
    const params = buildLinmiaoCreateOrderParams(input, this.supplier.platformType);
    const result = await createOrder(params);
    return {
      platformOid: input.platformOid,
      traceId: result.traceId,
      pushed: true,
      raw: result.data,
    };
  }

  async pushToFactory(platformOids: string[]): Promise<SupplierPushToFactoryResult> {
    // Orders are already at the factory the moment they're created.
    return { succeeded: [...platformOids], failed: [] };
  }

  async queryStatus(platformOids: string[]): Promise<SupplierOrderStatus[]> {
    const res = await linmiaoQueryOrderStatus(platformOids);
    if (!Array.isArray(res.data)) return [];
    // Response shape is loosely documented; map tolerantly.
    return (res.data as Record<string, unknown>[]).map((r) => ({
      platformOid: String(r.platformOid ?? r.pfOrderId ?? r.orderId ?? ""),
      orderStatus: typeof r.orderStatus === "number" ? r.orderStatus : null,
      orderStatusStr:
        typeof r.orderStateStr === "string"
          ? r.orderStateStr
          : typeof r.orderStatusStr === "string"
            ? r.orderStatusStr
            : null,
    }));
  }
}
