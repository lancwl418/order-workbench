import { createHash } from "crypto";

// Raw client for the riin T-shirt POD API (see docs/blanks-push-plan.md and
// T恤第三方接口-20250819.pdf). One instance per supplier — factories sharing
// the riin system (jjspromo, xinfeiyang, …) each have their own secretKey.

const DEFAULT_BASE_URL = "https://tshirt-test.riin.com/";

export interface RiinResponse<T = unknown> {
  successful: boolean;
  message: string;
  errorCode: string;
  data: T;
  traceId?: string;
}

export interface RiinImage {
  type: 1 | 2; // 1=打印图(png only), 2=效果图
  imageUrl: string;
  imageCode: string;
  imageName: string;
}

export interface RiinGoodsItem {
  platformOid: string;
  platformOllId: string;
  goodsType: 1;
  title: string;
  specification?: string;
  goodsStatus: "NOT_SHIPPED";
  refundStatus: "NO_REFUND";
  sizeCode: string;
  sizeName: string;
  colorCode: string;
  colorName: string;
  styleCode: string;
  styleName: string;
  craftType: 1 | 2;
  num: number;
  platformSpuId?: string;
  platformSkuId?: string;
  remark?: string;
  price?: number;
  sellPrice?: number;
  printPosition?: string;
  imageList: RiinImage[];
}

export interface RiinPlaceOrderParams {
  platformType: number;
  sourcePlatformOid: string;
  platformOrderStatus: "NOT_SHIPPED";
  platformRefundStatus: "NO_REFUND";
  platformOid: string;
  consigneeName: string;
  phone: string;
  address: string;
  addressOptional?: string;
  receiverCountry: string;
  receiverProvince: string;
  receiverCity: string;
  receiverDistrict?: string;
  receiverTown?: string;
  postCode?: string;
  orderTime: string; // yyyy-MM-dd HH:mm:ss
  orderPayTime?: string;
  sellerRemark?: string;
  goodsList: RiinGoodsItem[];
}

export interface RiinPushOrderData {
  total: number;
  failed: number;
  succeeded: number;
  errMessages?: { key: string; value: string }[];
  appendKeys?: string[];
}

export interface RiinOrderStatusRecord {
  platformOid: string;
  orderStatus: number;
  orderStateStr?: string;
  childOrderStatus?: { platformOllId: string; goodsStatus: string; goodsStatusStr: string }[];
}

export class RiinApiError extends Error {
  traceId?: string;
  errorCode?: string;
  constructor(message: string, traceId?: string, errorCode?: string) {
    super(message);
    this.name = "RiinApiError";
    this.traceId = traceId;
    this.errorCode = errorCode;
  }
}

export class RiinClient {
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(opts: { secretKey: string; baseUrl?: string | null }) {
    if (!opts.secretKey) {
      throw new Error("riin secretKey is empty — configure the supplier's secret env var");
    }
    this.secretKey = opts.secretKey;
    const raw = opts.baseUrl || process.env.RIIN_API_URL || DEFAULT_BASE_URL;
    this.baseUrl = raw.endsWith("/") ? raw : raw + "/";
  }

  private sign(body: string): string {
    return createHash("md5").update(body + "::" + this.secretKey).digest("hex");
  }

  private async post<T>(path: string, payload: unknown): Promise<RiinResponse<T>> {
    const body = JSON.stringify(payload);
    const url = this.baseUrl + path.replace(/^\//, "");

    const REQUEST_TIMEOUT_MS = 30_000;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          secretKey: this.secretKey,
          sign: this.sign(body),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new RiinApiError(`riin API timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${path})`);
      }
      throw new RiinApiError(`riin API unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new RiinApiError(`riin HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    let parsed: RiinResponse<T>;
    try {
      parsed = JSON.parse(text) as RiinResponse<T>;
    } catch {
      throw new RiinApiError(`riin returned non-JSON response: ${text.slice(0, 500)}`);
    }

    if (!parsed.successful) {
      throw new RiinApiError(
        parsed.message || parsed.errorCode || "riin request failed",
        parsed.traceId,
        parsed.errorCode
      );
    }
    return parsed;
  }

  placeOrder(params: RiinPlaceOrderParams): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/placeOrder", params);
  }

  /**
   * Push placed orders to the factory. successful=true with data=null means
   * every order pushed; otherwise data.errMessages lists per-order failures.
   */
  pushOrder(platformOidList: string[]): Promise<RiinResponse<RiinPushOrderData | null>> {
    return this.post("trade/api/interface/pushOrder", { platformOidList });
  }

  queryOrderStatus(platformOidList: string[]): Promise<RiinResponse<RiinOrderStatusRecord[]>> {
    return this.post("trade/api/interface/queryOrderStatus", { platformOidList });
  }

  queryOrderDelivery(
    platformOidList: string[]
  ): Promise<RiinResponse<{ platformOid: string; trackingNumber?: string; waybillDataPath?: string; shippingTime?: string }[]>> {
    return this.post("trade/api/interface/queryOrderDelivery", { platformOidList });
  }

  closeOrder(platformOid: string): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/closeOrder", { platformOid });
  }

  queryStyle(pageIndex = 1, pageSize = 1000): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/queryStyle", { pageIndex, pageSize });
  }

  queryColor(pageIndex = 1, pageSize = 1000): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/queryColor", { pageIndex, pageSize });
  }

  querySize(pageIndex = 1, pageSize = 1000): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/querySize", { pageIndex, pageSize });
  }

  queryProduct(pageIndex = 1, pageSize = 1000): Promise<RiinResponse<unknown>> {
    return this.post("trade/api/interface/queryProduct", { pageIndex, pageSize });
  }
}
