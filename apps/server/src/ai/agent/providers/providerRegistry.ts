// Builds the provider registry service that resolves provider adapters by key.

import { ProviderUnavailableError } from "../runtime/errors";
import type { ProviderAdapter, ProviderRegistryService } from "./providerTypes";

export class ProviderRegistry implements ProviderRegistryService {
  readonly #providers: Map<string, ProviderAdapter>;

  constructor(adapters: readonly ProviderAdapter[]) {
    this.#providers = new Map(
      adapters.map((adapter) => [adapter.key, adapter]),
    );
  }

  get(providerKey: string): ProviderAdapter {
    const adapter = this.#providers.get(providerKey);
    if (!adapter) {
      throw new ProviderUnavailableError({ providerKey });
    }

    return adapter;
  }

  list(): readonly ProviderAdapter[] {
    return [...this.#providers.values()];
  }
}
