import type { Supplier } from "@prisma/client";
import { RiinClient, RiinApiError } from "./riin-client";
import type { RiinGoodsItem, RiinImage, RiinPlaceOrderParams } from "./riin-client";
import {
  formatOrderTime,
  noPrintMarkerUrl,
  type SupplierAdapter,
  type SupplierOrderInput,
  type SupplierOrderResult,
  type SupplierOrderStatus,
  type SupplierPushToFactoryResult,
} from "./types";

/**
 * Build the riin placeOrder payload from the unified input. Pure — exported
 * for tests. No-print blanks use the protocol's "[不打印]" type-1 marker plus
 * up to two effect images — image codes allow only letters, digits,
 * underscores, [] and Chinese, hence the underscore separators.
 */
export function buildRiinPlaceOrderParams(
  input: SupplierOrderInput,
  platformType: number
): RiinPlaceOrderParams {
  const goodsList: RiinGoodsItem[] = input.items.map((item, idx) => {
    const imageList: RiinImage[] = [];
    if (item.shouldPrint) {
      for (const [i, url] of item.printImageUrls.entries()) {
        imageList.push({
          type: 1,
          imageUrl: url,
          imageCode: `${item.orderItemId}_print_${i}`,
          imageName: `${item.orderItemId}_print_${i}`,
        });
      }
    } else {
      imageList.push({ type: 1, imageUrl: noPrintMarkerUrl(item), imageCode: "[不打印]", imageName: "noprint" });
    }
    for (const [i, url] of item.effectImageUrls.slice(0, 2).entries()) {
      imageList.push({
        type: 2,
        imageUrl: url,
        imageCode: `${item.orderItemId}_effect_${i}`,
        imageName: `${item.orderItemId}_effect_${i}`,
      });
    }

    return {
      platformOid: input.platformOid,
      platformOllId: `${input.platformOid}-${idx + 1}`,
      goodsType: 1 as const,
      title: item.title,
      specification: [item.colorName || item.colorCode, item.sizeName || item.sizeCode]
        .filter(Boolean)
        .join(" "),
      goodsStatus: "NOT_SHIPPED" as const,
      refundStatus: "NO_REFUND" as const,
      sizeCode: item.sizeCode,
      sizeName: item.sizeName || item.sizeCode,
      colorCode: item.colorCode,
      colorName: item.colorName || item.colorCode,
      styleCode: item.styleCode || item.factorySku,
      styleName: item.styleName || item.styleCode || item.factorySku,
      craftType: item.craftType,
      num: item.quantity,
      platformSpuId: item.ourSku || undefined,
      platformSkuId: item.factorySku,
      price: item.price,
      sellPrice: item.price,
      printPosition: item.shouldPrint ? item.printPosition : undefined,
      imageList,
    };
  });

  return {
    platformType,
    sourcePlatformOid: input.sourceOrderId,
    platformOrderStatus: "NOT_SHIPPED",
    platformRefundStatus: "NO_REFUND",
    platformOid: input.platformOid,
    consigneeName: input.consignee.name,
    phone: input.consignee.phone,
    address: input.consignee.address,
    addressOptional: input.consignee.addressOptional,
    receiverCountry: input.consignee.country,
    receiverProvince: input.consignee.province,
    receiverCity: input.consignee.city,
    receiverDistrict: input.consignee.district,
    receiverTown: input.consignee.town,
    postCode: input.consignee.postCode,
    orderTime: formatOrderTime(input.orderTime),
    sellerRemark: input.sellerRemark,
    goodsList,
  };
}

export class RiinAdapter implements SupplierAdapter {
  readonly supplier: Supplier;
  private readonly client: RiinClient;

  constructor(supplier: Supplier, client: RiinClient) {
    this.supplier = supplier;
    this.client = client;
  }

  async placeOrder(
    input: SupplierOrderInput,
    opts: { push: boolean }
  ): Promise<SupplierOrderResult> {
    const params = buildRiinPlaceOrderParams(input, this.supplier.platformType);
    const placed = await this.client.placeOrder(params);

    if (!opts.push) {
      return { platformOid: input.platformOid, traceId: placed.traceId, pushed: false, raw: placed.data };
    }

    // Two-step: the order sits in "pending push" until pushOrder forwards it
    // to the factory. A push failure is NOT a placement failure — the order
    // exists at the supplier and can be re-pushed after fixing the cause.
    const pushResult = await this.pushToFactory([input.platformOid]);
    const failure = pushResult.failed.find((f) => f.platformOid === input.platformOid);
    return {
      platformOid: input.platformOid,
      traceId: placed.traceId,
      pushed: !failure,
      pushError: failure?.reason,
      raw: placed.data,
    };
  }

  async pushToFactory(platformOids: string[]): Promise<SupplierPushToFactoryResult> {
    try {
      const res = await this.client.pushOrder(platformOids);
      // data null → every order pushed successfully
      if (!res.data) {
        return { succeeded: [...platformOids], failed: [], traceId: res.traceId };
      }
      const failed = (res.data.errMessages ?? []).map((m) => ({
        platformOid: m.key,
        reason: m.value,
      }));
      const failedSet = new Set(failed.map((f) => f.platformOid));
      return {
        succeeded: platformOids.filter((oid) => !failedSet.has(oid)),
        failed,
        traceId: res.traceId,
      };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "pushOrder failed";
      const traceId = e instanceof RiinApiError ? e.traceId : undefined;
      return {
        succeeded: [],
        failed: platformOids.map((platformOid) => ({ platformOid, reason })),
        traceId,
      };
    }
  }

  async queryStatus(platformOids: string[]): Promise<SupplierOrderStatus[]> {
    const res = await this.client.queryOrderStatus(platformOids);
    return (res.data ?? []).map((r) => ({
      platformOid: r.platformOid,
      orderStatus: r.orderStatus ?? null,
      orderStatusStr: r.orderStateStr ?? null,
    }));
  }
}
