import { describe, it, expect } from "vitest";
import {
  buildFpSignText,
  flattenFpParams,
  signFpRequest,
} from "@/lib/suppliers/fp-client";
import {
  buildFpPlaceOrderParams,
  fpImageName,
  normalizeFpStatus,
  splitRecipientName,
  validateFpOrderInput,
  FP_TO_SHARED_STATUS,
} from "@/lib/suppliers/fp";
import type { SupplierOrderInput } from "@/lib/suppliers/types";

function makeInput(overrides: Partial<SupplierOrderInput> = {}): SupplierOrderInput {
  return {
    platformOid: "1001-xinfeiyang",
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
        factorySku: "FP-SKU-001",
        sizeCode: "",
        sizeName: "",
        colorCode: "",
        colorName: "",
        styleCode: "",
        styleName: "",
        craftType: 1,
        shouldPrint: false,
        printImageUrls: [],
        effectImageUrls: ["https://cdn.example.com/effect.png"],
      },
    ],
    fpLogisticsType: 0,
    ...overrides,
  };
}

describe("FP signature", () => {
  it("flattens objects with dots and arrays with indexes, skipping nulls", () => {
    const flat = flattenFpParams({
      a: { b: "x" },
      items: [{ id: 1 }, { id: 2 }],
      nil: null,
      flag: true,
    });
    expect(flat).toEqual({
      "a.b": "x",
      "items[0].id": "1",
      "items[1].id": "2",
      flag: "true",
    });
  });

  it("reproduces the doc example signText exactly", () => {
    // From "FP ERP Open API Integration Guide" §4.2
    const body = {
      appKey: "test123",
      requestId: "111",
      timestamp: 1710000000000,
      spuIds: ["1998295442372718594"],
    };
    expect(buildFpSignText(body)).toBe(
      "appKey=test123&requestId=111&spuIds[0]=1998295442372718594&timestamp=1710000000000"
    );
  });

  it("excludes the signature field itself and sorts keys", () => {
    const body = {
      signature: "SHOULD_BE_IGNORED",
      b: "2",
      a: "1",
    };
    expect(buildFpSignText(body)).toBe("a=1&b=2");
  });

  it("produces a stable Base64 HMAC-SHA256", () => {
    const body = { appKey: "test123", requestId: "111", timestamp: 1710000000000 };
    const sig = signFpRequest(body, "secret1");
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // Same input, same secret → same signature; different secret → different
    expect(signFpRequest(body, "secret1")).toBe(sig);
    expect(signFpRequest(body, "secret2")).not.toBe(sig);
  });
});

describe("splitRecipientName", () => {
  it("uses the last word as last name", () => {
    expect(splitRecipientName("Chloe Kay")).toEqual({ firstName: "Chloe", lastName: "Kay" });
    expect(splitRecipientName("Mary Jane Watson")).toEqual({ firstName: "Mary Jane", lastName: "Watson" });
  });
  it("pads single-word names (both fields are required)", () => {
    expect(splitRecipientName("Cher")).toEqual({ firstName: "Cher", lastName: "-" });
  });
});

describe("buildFpPlaceOrderParams", () => {
  it("builds a no-print item as goodsMode=2 without images", () => {
    const params = buildFpPlaceOrderParams(makeInput());
    expect(params.platformOid).toBe("1001-xinfeiyang");
    expect(params.recipientFirstName).toBe("Chloe");
    expect(params.recipientLastName).toBe("Kay");
    expect(params.recipientState).toBe("TX");
    expect(params.saleCountry).toBe("US");
    expect(params.logisticsType).toBe(0);
    expect(params.orderGoodsList).toHaveLength(1);
    const g = params.orderGoodsList[0];
    expect(g.goodsMode).toBe(2);
    expect(g.systemSku).toBe("FP-SKU-001");
    expect(g.quantity).toBe(2);
    expect(g.productionImages).toBeUndefined();
    expect(g.thumbUrl).toBe("https://cdn.example.com/effect.png");
  });

  it("builds a printed item as goodsMode=1 with asset-center image names", () => {
    const input = makeInput();
    input.items[0] = {
      ...input.items[0],
      shouldPrint: true,
      craftType: 2,
      printImageUrls: ["https://cdn.example.com/print.png"],
      fpPrintCode: "front",
      fpPrintWidth: 25,
      fpPrintHeight: 30,
    };
    const params = buildFpPlaceOrderParams(input);
    const g = params.orderGoodsList[0];
    expect(g.goodsMode).toBe(1);
    expect(g.productProcessId).toBe(2);
    expect(g.productionImages).toEqual([
      {
        printCode: "front",
        productionImageName: fpImageName("item1", 0),
        widthInBlueMask: 25,
        heightInBlueMask: 30,
      },
    ]);
  });

  it("passes the own-label logistics type through", () => {
    const params = buildFpPlaceOrderParams(makeInput({ fpLogisticsType: 1 }));
    expect(params.logisticsType).toBe(1);
  });
});

describe("validateFpOrderInput", () => {
  it("accepts a valid no-print input", () => {
    expect(validateFpOrderInput(makeInput())).toBeNull();
  });
  it("requires a post code", () => {
    const input = makeInput();
    input.consignee.postCode = "";
    expect(validateFpOrderInput(input)).toMatch(/post code/i);
  });
  it("requires print code + width for printed items", () => {
    const input = makeInput();
    input.items[0] = {
      ...input.items[0],
      shouldPrint: true,
      printImageUrls: ["https://cdn.example.com/print.png"],
    };
    expect(validateFpOrderInput(input)).toMatch(/print position code/i);
    input.items[0].fpPrintCode = "front";
    expect(validateFpOrderInput(input)).toMatch(/print width/i);
    input.items[0].fpPrintWidth = 25;
    expect(validateFpOrderInput(input)).toBeNull();
  });
});

describe("normalizeFpStatus", () => {
  it("maps FP codes onto the shared status enum", () => {
    expect(normalizeFpStatus(150).orderStatus).toBe(2); // ready to push → 待推送
    expect(normalizeFpStatus(300).orderStatus).toBe(5); // production
    expect(normalizeFpStatus(350).orderStatus).toBe(12); // shipped
    expect(normalizeFpStatus(400).orderStatus).toBe(3); // reverse review → 反审
    expect(normalizeFpStatus(800).orderStatus).toBe(13); // closed
  });
  it("keeps the original FP code visible in the status string", () => {
    expect(normalizeFpStatus(130).orderStatusStr).toBe("物流匹配中(FP:130)");
  });
  it("keeps unknown codes in a pre-push (still polled) state", () => {
    const unknown = normalizeFpStatus(999);
    expect(unknown.orderStatus).toBe(1);
    expect(unknown.orderStatusStr).toContain("999");
  });
  it("covers every documented FP status", () => {
    for (const code of [100, 130, 150, 250, 300, 350, 400, 800]) {
      expect(FP_TO_SHARED_STATUS[code]).toBeDefined();
    }
  });
});

describe("fpImageName", () => {
  it("sanitizes to letters/digits/underscore", () => {
    expect(fpImageName("item-1.a", 0)).toBe("item_1_a_print_0");
  });
});
