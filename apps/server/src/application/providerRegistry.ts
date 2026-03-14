import type { ProviderKey } from "../../../../packages/contracts/src/provider";
import { MagickError } from "../../../../packages/shared/src/errors";
import type { ProviderAdapter } from "../providers/providerTypes";

export class ProviderRegistry {
  readonly #providers = new Map<ProviderKey, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.#providers.set(adapter.key, adapter);
  }

  get(providerKey: ProviderKey): ProviderAdapter {
    const adapter = this.#providers.get(providerKey);
    if (!adapter) {
      throw new MagickError(
        "provider_not_registered",
        `No provider registered for '${providerKey}'.`,
      );
    }

    return adapter;
  }
}
