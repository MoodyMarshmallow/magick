import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { attachWebSocketServer, createBackendServices } from "./index";

describe("createBackendServices", () => {
  it("builds services with fake and codex providers registered", () => {
    const services = createBackendServices();

    expect(services.providerRegistry.get("codex")).toMatchObject({
      key: "codex",
    });
    expect(services.providerRegistry.get("fake")).toMatchObject({
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
