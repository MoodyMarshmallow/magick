// Builds the provider registry service that resolves provider adapters by key.

import { Effect, Layer } from "effect";

import { ProviderUnavailableError } from "../effect/errors";
import {
  type ProviderAdapter,
  ProviderRegistry,
} from "../providers/providerTypes";

export const makeProviderRegistryLayer = (
  adapters: readonly ProviderAdapter[],
) => {
  const providers = new Map(adapters.map((adapter) => [adapter.key, adapter]));

  return Layer.succeed(ProviderRegistry, {
    get: (providerKey) => {
      const adapter = providers.get(providerKey);
      return adapter
        ? Effect.succeed(adapter)
        : Effect.fail(new ProviderUnavailableError({ providerKey }));
    },
  });
};
