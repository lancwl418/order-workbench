import type {
  EccangResponse,
  EccangProduct,
  EccangOrderParams,
  EccangOrderResult,
  EccangEstimateResult,
  EccangTrackDetail,
  EccangTrackingNumber,
} from "./types";

const BASE_URL =
  process.env.ECCANGTMS_BASE_URL || "https://api.saas.eccangtms.com";

function getApiToken(): string {
  const token = process.env.ECCANGTMS_API_TOKEN;
  if (!token) {
    throw new Error(
      "ECCANGTMS_API_TOKEN is not set. Configure EccangTMS env vars to use this feature."
    );
  }
  return token;
}

async function post<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<EccangResponse<T>> {
  const apiToken = getApiToken();
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiToken, ...body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EccangTMS HTTP ${res.status}: ${text}`);
  }

  const data: EccangResponse<T> = await res.json();
  if (!data.success || data.code !== 1) {
    throw new Error(
      `EccangTMS [${data.code}]: ${data.message || "Unknown error"}`
    );
  }

  return data;
}

/** 1. Get available shipping products */
export async function listProducts(): Promise<EccangProduct[]> {
  const data = await post<EccangProduct[]>("/open-api/product/list", {});
  return data.result;
}

/** 2. Estimate shipping cost (same params as create, minus async) */
export async function calculateShipping(
  params: Omit<EccangOrderParams, "apiToken" | "async" | "sameCustomerNoHandler">
): Promise<EccangEstimateResult[]> {
  const data = await post<EccangEstimateResult[]>(
    "/open-api/order/calculate",
    params as Record<string, unknown>
  );
  return data.result;
}

/** 3. Create a shipping order */
export async function createOrder(
  params: Omit<EccangOrderParams, "apiToken">
): Promise<EccangOrderResult> {
  const data = await post<EccangOrderResult>(
    "/open-api/order/create",
    params as Record<string, unknown>
  );
  return data.result;
}

/** 4. Get tracking details by serverNos */
export async function getTrackDetails(
  serverNos: string[]
): Promise<EccangTrackDetail[]> {
  const data = await post<EccangTrackDetail[]>(
    "/open-api/order/getTrackDetails",
    { serverNos }
  );
  return data.result;
}

/** 5. Get tracking numbers by orderNo */
export async function getTrackingNumber(
  orderNo: string
): Promise<EccangTrackingNumber[]> {
  const data = await post<EccangTrackingNumber[]>(
    "/open-api/order/getTrackingNumber",
    { orderNo }
  );
  return data.result;
}
