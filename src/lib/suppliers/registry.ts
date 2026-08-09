import type { Supplier } from "@prisma/client";
import { LinmiaoAdapter } from "./linmiao";
import { RiinAdapter } from "./riin";
import { RiinClient } from "./riin-client";
import type { SupplierAdapter } from "./types";

/**
 * Build the adapter for a Supplier row. riin suppliers each carry their own
 * secretKey (read from the env var named by secretKeyEnv) while sharing the
 * riin base URL; linmiao keeps using the existing factory client env vars.
 */
export function getAdapter(supplier: Supplier): SupplierAdapter {
  if (!supplier.enabled) {
    throw new Error(`Supplier ${supplier.key} is disabled`);
  }
  switch (supplier.adapterType) {
    case "linmiao":
      return new LinmiaoAdapter(supplier);
    case "riin": {
      const secretKey = process.env[supplier.secretKeyEnv];
      if (!secretKey) {
        throw new Error(
          `Env var ${supplier.secretKeyEnv} is not set — configure the secret key for supplier ${supplier.key}`
        );
      }
      return new RiinAdapter(
        supplier,
        new RiinClient({ secretKey, baseUrl: supplier.baseUrl })
      );
    }
    default:
      throw new Error(`Unknown supplier adapter type: ${supplier.adapterType}`);
  }
}
