import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { attachWebSocketServer, createBackendServices } from "./index";
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

  it("attaches the websocket server without throwing", () => {
    const services = createBackendServices();
    const server = createServer();

    expect(() => attachWebSocketServer(server, services)).not.toThrow();
    server.close();
  });

  it("creates a persistent database path by default and respects overrides", () => {
    const customPath = join(process.cwd(), ".magick-test", "backend.db");
    rmSync(join(process.cwd(), ".magick-test"), {
      recursive: true,
      force: true,
    });

    const custom = createBackendServices({ databasePath: customPath });
    expect(custom.databasePath).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);

    const defaultServices = createBackendServices();
    expect(defaultServices.databasePath.endsWith(".magick/backend.db")).toBe(
      true,
    );

    rmSync(join(process.cwd(), ".magick-test"), {
      recursive: true,
      force: true,
    });
  });
});
