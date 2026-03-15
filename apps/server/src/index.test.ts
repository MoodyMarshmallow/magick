import { createBackendServices } from "./index";
import { ProviderRegistry } from "./providers/providerTypes";

describe("createBackendServices", () => {
  it("builds a runtime with fake and codex providers registered", async () => {
    const services = createBackendServices();
    const registry = (await services.runtime.runPromise(
      ProviderRegistry as never,
    )) as {
      readonly get: (providerKey: string) => Promise<unknown> | unknown;
    };

    await expect(
      services.runtime.runPromise(registry.get("codex") as never),
    ).resolves.toMatchObject({
      key: "codex",
    });
    await expect(
      services.runtime.runPromise(registry.get("fake") as never),
    ).resolves.toMatchObject({
      key: "fake",
    });
  });
});
