// ─── API Response Wrapper ────────────────────────────────────
export interface EccangResponse<T> {
  success: boolean;
  message: string | null;
  code: number;
  result: T;
  timestamp: number;
}

// ─── Products ────────────────────────────────────────────────
export interface EccangProduct {
  id: string;
  name: string;
  nameLang2: string;
  code: string;
  effectiveTime: string;
  productLogoUrl: string;
  remark: string;
}

// ─── ConsigneeShipper ───────────────────────────────────────
export interface EccangConsigneeShipper {
  consigneeName: string;
  consigneeCompanyName: string;
  consigneeCountryCode: string;
  consigneeStateOrProvince: string;
  consigneeCity: string;
  consigneeArea?: string;
  consigneeAddress1: string;
  consigneeAddress2?: string;
  consigneeAddress3?: string;
  consigneePostCode: string;
  consigneePhone: string;
  consigneeEmail?: string;
  consigneeHouseNumber?: string;
  consigneeCode?: string;
  shipperName: string;
  shipperCompanyName: string;
  shipperCountryCode: string;
  shipperStateOrProvince: string;
  shipperCity: string;
  shipperArea?: string;
  shipperAddress1: string;
  shipperAddress2?: string;
  shipperAddress3?: string;
  shipperPostCode: string;
  shipperPhone: string;
  shipperEmail?: string;
  shipperHouseNumber?: string;
  shipperCode?: string;
}

// ─── Box & Goods ─────────────────────────────────────────────
export interface EccangBox {
  boxNo: string;
  boxWeight: number;
  boxLength: number;
  boxWidth: number;
  boxHeight: number;
  boxVolume?: number | null;
}

export interface EccangGoods {
  goodsName: string;
  goodsNameEn: string;
  declareUnit: string;
  quantity: number;
  value: number;
  weight: number;
  goodsMessage?: string;
  hsCode?: string;
  goodsLink?: string;
  sku?: string;
  boxNo: string;
}

// ─── Create / Calculate Order Params ─────────────────────────
export interface EccangOrderParams {
  apiToken?: string;
  productCode: string;
  customerNo: string;
  goodsType: number;
  orderWeight: number;
  weightSizeUnit: number;
  currencyCode: string;
  async?: number;
  signatureService?: string;
  insuranceValue?: string;
  insuranceCurrencyCode?: string;
  sameCustomerNoHandler?: string;
  consigneeShipper: EccangConsigneeShipper;
  boxList: EccangBox[];
  goodsList: EccangGoods[];
}

// ─── Create Order Result ─────────────────────────────────────
export interface EccangOrderResult {
  orderNo: string;
  serverNo: string;
  customerNo: string;
  thirdNo: string | null;
  goodsType: number;
  orderWeight: number;
  chargeWeight: number;
  boxCount: number;
  declaredValue: number;
  currencyCode: string;
  totalPrice: number;
  realPrice: number;
  status: number;
  failReason: string | null;
  productName: string;
  productCode: string;
  payTime: string;
  createTime: string;
  consigneeShipper: unknown;
  orderDetailList: unknown[];
  orderBoxList: unknown[];
  feeDetail: EccangFeeDetail;
}

export interface EccangFeeDetail {
  settleCurrency: string;
  settleTotalOriginalPrice: number;
  settleTotalPrice: number;
  settleTotalDiscount: number;
  feeList: EccangFeeItem[];
}

export interface EccangFeeItem {
  expenseType: string;
  expenseAmount: number;
  currencyCode: string;
  currencyRate: number | null;
  rmbAmount: number | null;
  remark: string | null;
  expenseType_dictText: string;
}

// ─── Calculate (Estimate) Result ─────────────────────────────
export interface EccangEstimateResult {
  feeDeviation: boolean;
  weightSizeUnit: number;
  totalPrice: number;
  effectiveTime: string;
  feeList: EccangFeeItem[];
  productName: string;
  productCode: string;
  remoteFlag: boolean;
  incomeZdName: string;
  productNameLang2?: string;
  currencyCode: string;
  totalRmbPrice: number;
  chargedWeight: number;
}

// ─── Tracking ────────────────────────────────────────────────
export interface EccangTrackDetail {
  serverNo: string;
  customerNo: string;
  lastDate: string;
  status: string;
  trackDescription: string;
  trackLocation: string;
  carrierCode: string;
  timeZone: string;
  fromDetail: EccangTrackEvent[];
  timestamp: number;
}

export interface EccangTrackEvent {
  trackTime: string;
  trackDescription: string;
  trackLocation: string;
  status: string;
  country: string;
  state: string;
  city: string;
  timeZone: string;
}

// ─── Tracking Number ─────────────────────────────────────────
export interface EccangTrackingNumber {
  boxNo: string;
  serverNo: string;
}

// ─── Travel Status Mapping ───────────────────────────────────
export const ECCANG_TRAVEL_STATUS: Record<string, string> = {
  "0": "no_tracking",
  "1": "no_tracking",
  "2": "no_tracking",
  "2000": "label_created",
  "3": "in_transit",
  "3000": "collected",
  "4": "ready_for_pickup",
  "5": "delivered",
  "6": "delivery_failed",
  "7": "exception",
  "8": "long_transit",
  "9000": "returned",
};
