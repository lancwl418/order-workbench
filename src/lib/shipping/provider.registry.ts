import type { ShippingProvider } from "./provider.interface";
import { GenericProvider } from "./generic-provider";

const providers = new Map<string, ShippingProvider>();

// Register built-in providers
providers.set("generic", new GenericProvider());

export function registerProvider(provider: ShippingProvider): void {
  providers.set(provider.name, provider);
}

export function getProvider(name?: string): ShippingProvider {
  const providerName = name || process.env.SHIPPING_DEFAULT_PROVIDER || "generic";
  const provider = providers.get(providerName);
  if (!provider) {
    throw new Error(`Shipping provider "${providerName}" not registered`);
  }
  return provider;
}

export function listProviders(): string[] {
  return Array.from(providers.keys());
}
