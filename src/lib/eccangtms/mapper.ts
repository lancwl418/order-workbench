import type { Order, OrderItem } from "@prisma/client";
import type { ShopifyAddress } from "@/lib/shopify/types";
import type { EccangOrderParams, EccangConsigneeShipper, EccangBox, EccangGoods } from "./types";

export interface PackageInfo {
  weightLbs: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

/**
 * Maps a workbench Order + OrderItems to EccangTMS order params.
 *
 * Key business rules from user:
 * - customerNo = our shopifyOrderNumber
 * - consigneeName = "{name}-{orderNumber}"
 * - goodsType = 3 (package)
 * - weightSizeUnit = 2 (inch/lb)
 * - box count = 1
 * - declaration: quantity=1, unit="box", name="transfers"
 * - value = total order price
 */
export function mapOrderToEccangParams(
  order: Order & { orderItems: OrderItem[] },
  productCode: string,
  pkg: PackageInfo
): EccangOrderParams {
  const addr = (order.shippingAddress as ShopifyAddress | null) || {};
  const orderNumber = order.shopifyOrderNumber?.replace("#", "") || order.id.slice(0, 8);

  const recipientName =
    `${addr.first_name || ""} ${addr.last_name || ""}`.trim() ||
    order.customerName ||
    "";

  const consigneeShipper: EccangConsigneeShipper = {
    // Consignee (recipient)
    consigneeName: `${recipientName}-${orderNumber}`,
    consigneeCompanyName: addr.company || "",
    consigneeCountryCode: addr.country_code || "US",
    consigneeStateOrProvince: addr.province_code || addr.province || "",
    consigneeCity: addr.city || "",
    consigneeAddress1: addr.address1 || "",
    consigneeAddress2: addr.address2 || "",
    consigneePostCode: addr.zip || "",
    consigneePhone: addr.phone || order.customerPhone || "",
    consigneeEmail: order.customerEmail || "",
    // Shipper (our warehouse)
    shipperName: "LOGISTIC",
    shipperCompanyName: "IDEAMAX",
    shipperCountryCode: "US",
    shipperStateOrProvince: "CA",
    shipperCity: "City of Industry",
    shipperAddress1: "18751 Railroad St",
    shipperPostCode: "91789",
    shipperPhone: "6666666666",
    shipperEmail: "support@idea-max.com",
  };

  const boxNo = "BOX001";

  const boxList: EccangBox[] = [
    {
      boxNo,
      boxWeight: pkg.weightLbs,
      boxLength: pkg.lengthIn,
      boxWidth: pkg.widthIn,
      boxHeight: pkg.heightIn,
    },
  ];

  // Calculate total declared value from order items
  const totalValue = order.orderItems.reduce(
    (sum, item) => sum + parseFloat(String(item.price)) * item.quantity,
    0
  );

  const goodsList: EccangGoods[] = [
    {
      goodsName: "transfers",
      goodsNameEn: "transfers",
      declareUnit: "box",
      quantity: 1,
      value: totalValue || parseFloat(String(order.totalPrice)) || 10,
      weight: pkg.weightLbs,
      sku: order.orderItems[0]?.sku || "TRANSFER",
      boxNo,
    },
  ];

  return {
    productCode,
    customerNo: orderNumber,
    goodsType: 3,
    orderWeight: pkg.weightLbs,
    weightSizeUnit: 2, // imperial (in/lb)
    currencyCode: order.currency || "USD",
    async: 0,
    signatureService: "NO",
    sameCustomerNoHandler: "return_last_successful_data",
    consigneeShipper,
    boxList,
    goodsList,
  };
}
