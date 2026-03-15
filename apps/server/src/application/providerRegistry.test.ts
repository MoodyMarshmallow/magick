// Verifies provider registry lookup succeeds for registered adapters and fails for missing ones.

import { Cause, Effect, Exit, Option } from "effect";

import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import { ProviderRegistry } from "../providers/providerTypes";
import { makeProviderRegistryLayer } from "./providerRegistry";

describe("makeProviderRegistryLayer", () => {
  it("returns registered adapters", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const service = await Effect.runPromise(
      ProviderRegistry.pipe(
        Effect.provide(makeProviderRegistryLayer([adapter])),
      ),
    );

    const resolved = await Effect.runPromise(service.get(adapter.key));
    expect(resolved).toBe(adapter);
  });

  it("fails for missing providers", async () => {
    const service = await Effect.runPromise(
      ProviderRegistry.pipe(Effect.provide(makeProviderRegistryLayer([]))),
    );

    const exit = await Effect.runPromiseExit(service.get("missing"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        _tag: "ProviderUnavailableError",
        providerKey: "missing",
      });
    }
  });
});
