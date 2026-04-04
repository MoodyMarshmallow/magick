import { resolveDesktopBackendDatabasePath } from "./backendRuntime";

describe("resolveDesktopBackendDatabasePath", () => {
  it("stores the embedded backend database under Electron user data", () => {
    expect(resolveDesktopBackendDatabasePath("/tmp/magick-user-data")).toBe(
      "/tmp/magick-user-data/backend.db",
    );
  });
});
