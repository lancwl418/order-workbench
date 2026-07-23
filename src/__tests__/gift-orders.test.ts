import { describe, expect, it } from "vitest";
import type { GiftOrder, GiftSegment } from "@prisma/client";
import { mapGiftOrderToEccangParams } from "@/lib/eccangtms/mapper";

const segment = {
  id: "segment_1",
  name: "VIP",
  giftTitle: "VIP Gift Box",
  giftSku: "GIFT-VIP-01",
  giftQuantity: 2,
  giftValue: 18,
  weightLbs: 1.5,
  lengthIn: 12,
  widthIn: 9,
  heightIn: 3,
} as GiftSegment;

const order = {
  id: "gift_order_abcdefghijkl",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  customerPhone: "5551234567",
  shippingAddress: {
    first_name: "Jane",
    last_name: "Doe",
    company: "Example Co",
    address1: "123 Main St",
    address2: "Suite 4",
    city: "Los Angeles",
    province_code: "CA",
    zip: "90001",
    country_code: "US",
    phone: "5551234567",
  },
} as unknown as GiftOrder;

describe("mapGiftOrderToEccangParams", () => {
  it("uses the customer address and a stable non-Shopify order number", () => {
    const params = mapGiftOrderToEccangParams(order, segment, "USPS-GA");

    expect(params.customerNo).toBe("GIFT-ABCDEFGHIJKL");
    expect(params.productCode).toBe("USPS-GA");
    expect(params.consigneeShipper).toMatchObject({
      consigneeName: "Jane Doe-GIFT-ABCDEFGHIJKL",
      consigneeAddress1: "123 Main St",
      consigneeAddress2: "Suite 4",
      consigneeCity: "Los Angeles",
      consigneeStateOrProvince: "CA",
      consigneePostCode: "90001",
      consigneeCountryCode: "US",
    });
  });

  it("uses the segment's shared gift and package configuration", () => {
    const params = mapGiftOrderToEccangParams(order, segment, "");

    expect(params.orderWeight).toBe(1.5);
    expect(params.boxList).toEqual([
      {
        boxNo: "BOX001",
        boxWeight: 1.5,
        boxLength: 12,
        boxWidth: 9,
        boxHeight: 3,
      },
    ]);
    expect(params.goodsList[0]).toMatchObject({
      goodsName: "VIP Gift Box",
      goodsNameEn: "VIP Gift Box",
      quantity: 2,
      value: 18,
      sku: "GIFT-VIP-01",
      weight: 1.5,
    });
  });
});
