// Verifies provider registry lookup succeeds for registered adapters and fails for missing ones.

import { FakeProviderAdapter } from "./fake/fakeProviderAdapter";
import { ProviderRegistry } from "./providerRegistry";

describe("ProviderRegistry", () => {
  it("returns registered adapters", () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const service = new ProviderRegistry([adapter]);

    expect(service.get(adapter.key)).toBe(adapter);
  });

  it("fails for missing providers", () => {
    const service = new ProviderRegistry([]);

    expect(() => service.get("missing")).toThrowError(
      expect.objectContaining({
        _tag: "ProviderUnavailableError",
        providerKey: "missing",
      }),
    );
  });
});
