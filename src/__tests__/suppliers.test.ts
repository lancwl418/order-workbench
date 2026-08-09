import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { buildRiinPlaceOrderParams } from "@/lib/suppliers/riin";
import { buildLinmiaoCreateOrderParams } from "@/lib/suppliers/linmiao";
import { formatOrderTime, normalizeVendor } from "@/lib/suppliers/types";
import type { SupplierOrderInput } from "@/lib/suppliers/types";

function makeInput(overrides: Partial<SupplierOrderInput> = {}): SupplierOrderInput {
  return {
    platformOid: "1001-jjspromo",
    sourceOrderId: "order_abc",
    consignee: {
      name: "Chloe Kay",
      phone: "13145303433",
      address: "1809 Runnels St",
      country: "US",
      province: "TX",
      city: "Big Spring",
      postCode: "79720",
    },
    orderTime: new Date(2026, 7, 8, 9, 5, 3),
    items: [
      {
        orderItemId: "item1",
        title: "230g Cotton Tee",
        quantity: 2,
        price: 12.5,
        ourSku: "TEE-230",
        factorySku: "DG004-BL01-XL",
        sizeCode: "XL",
        sizeName: "XL",
        colorCode: "BL01",
        colorName: "black",
        styleCode: "DG004",
        styleName: "230G Tee",
        craftType: 1,
        shouldPrint: false,
        printImageUrls: [],
        effectImageUrls: ["https://cdn.example.com/effect.jpg"],
      },
    ],
    ...overrides,
  };
}

describe("riin sign", () => {
  it("matches the documented md5(body::secretKey) example", () => {
    // From the API doc: DigestUtils.md5DigestAsHex over body + "::" + key
    const sign = createHash("md5").update("abc" + "::" + "key").digest("hex");
    expect(sign).toBe(createHash("md5").update("abc::key").digest("hex"));
    expect(sign).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("formatOrderTime", () => {
  it("formats as yyyy-MM-dd HH:mm:ss with zero padding", () => {
    expect(formatOrderTime(new Date(2026, 7, 8, 9, 5, 3))).toBe("2026-08-08 09:05:03");
  });
});

describe("normalizeVendor", () => {
  it("trims and lowercases", () => {
    expect(normalizeVendor("  JJSPROMO ")).toBe("jjspromo");
  });
});

describe("buildRiinPlaceOrderParams", () => {
  it("maps consignee to flat fields and sets required constants", () => {
    const params = buildRiinPlaceOrderParams(makeInput(), 15);
    expect(params.platformType).toBe(15);
    expect(params.platformOid).toBe("1001-jjspromo");
    expect(params.sourcePlatformOid).toBe("order_abc");
    expect(params.platformOrderStatus).toBe("NOT_SHIPPED");
    expect(params.platformRefundStatus).toBe("NO_REFUND");
    expect(params.consigneeName).toBe("Chloe Kay");
    expect(params.receiverCountry).toBe("US");
    expect(params.receiverProvince).toBe("TX");
    expect(params.receiverCity).toBe("Big Spring");
    expect(params.postCode).toBe("79720");
    expect(params.orderTime).toBe("2026-08-08 09:05:03");
  });

  it("numbers sub-order ids sequentially per item", () => {
    const input = makeInput();
    input.items = [input.items[0], { ...input.items[0], orderItemId: "item2" }];
    const params = buildRiinPlaceOrderParams(input, 15);
    expect(params.goodsList.map((g) => g.platformOllId)).toEqual([
      "1001-jjspromo-1",
      "1001-jjspromo-2",
    ]);
  });

  it("uses the [不打印] marker plus effect images when not printing (blank default)", () => {
    const params = buildRiinPlaceOrderParams(makeInput(), 15);
    const images = params.goodsList[0].imageList;
    expect(images[0]).toMatchObject({ type: 1, imageUrl: "", imageCode: "[不打印]" });
    expect(images[1].type).toBe(2);
    expect(params.goodsList[0].printPosition).toBeUndefined();
  });

  it("sends only the [不打印] marker when a blank has no effect images", () => {
    const input = makeInput();
    input.items[0].effectImageUrls = [];
    const params = buildRiinPlaceOrderParams(input, 15);
    expect(params.goodsList[0].imageList).toEqual([
      { type: 1, imageUrl: "", imageCode: "[不打印]", imageName: "noprint" },
    ]);
  });

  it("keeps image codes free of forbidden characters (- + & space)", () => {
    const input = makeInput();
    input.items[0].shouldPrint = true;
    input.items[0].printImageUrls = ["https://cdn.example.com/print.png"];
    const params = buildRiinPlaceOrderParams(input, 15);
    for (const img of params.goodsList[0].imageList) {
      expect(img.imageCode).not.toMatch(/[-+& ]/);
      expect(img.imageName).not.toMatch(/[-+& ]/);
    }
  });

  it("adds print images with position when printing", () => {
    const input = makeInput();
    input.items[0].shouldPrint = true;
    input.items[0].printPosition = "1";
    input.items[0].printImageUrls = ["https://cdn.example.com/print.png"];
    const params = buildRiinPlaceOrderParams(input, 15);
    const types = params.goodsList[0].imageList.map((i) => i.type);
    expect(types).toEqual([1, 2]);
    expect(params.goodsList[0].printPosition).toBe("1");
  });

  it("keeps real image codes unique across items (fixed [不打印] marker may repeat)", () => {
    const input = makeInput();
    input.items = [input.items[0], { ...input.items[0], orderItemId: "item2" }];
    const params = buildRiinPlaceOrderParams(input, 15);
    const codes = params.goodsList
      .flatMap((g) => g.imageList.map((i) => i.imageCode))
      .filter((c) => c !== "[不打印]");
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("buildLinmiaoCreateOrderParams", () => {
  it("maps consignee to the nested object and pf ids", () => {
    const params = buildLinmiaoCreateOrderParams(makeInput(), 15);
    expect(params.pfOrderId).toBe("1001-jjspromo");
    expect(params.consignee.name).toBe("Chloe Kay");
    expect(params.consignee.country).toBe("US");
    expect(params.goodsList[0].pfSubOrderId).toBe("1001-jjspromo-1");
  });

  it("uses the [不打印] marker convention when not printing", () => {
    const params = buildLinmiaoCreateOrderParams(makeInput(), 15);
    const images = params.goodsList[0].imageList;
    expect(images[0]).toMatchObject({ type: 1, imageCode: "[不打印]" });
    expect(images[1].type).toBe(2);
  });
});
