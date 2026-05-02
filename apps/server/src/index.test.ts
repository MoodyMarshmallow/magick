import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  attachWebSocketServer,
  createBackendServices,
  resolveBackendRepoRoot,
  resolveDefaultDatabasePath,
  resolveDefaultWorkspaceRoot,
} from "./index";

const removeTestDatabaseDirectory = (directoryPath: string) => {
  rmSync(directoryPath, {
    recursive: true,
    force: true,
  });
};

describe("createBackendServices", () => {
  it("builds services with only the real provider by default", () => {
    const services = createBackendServices();

    expect(services.providerRegistry.get("codex")).toMatchObject({
      key: "codex",
    });
    expect(() => services.providerRegistry.get("fake")).toThrow();
    expect(() => services.providerRegistry.get("fake-tools")).toThrow();
  });

  it("can include fake providers for tests when requested", () => {
    const services = createBackendServices({ includeFakeProviders: true });

    expect(services.providerRegistry.get("codex")).toMatchObject({
      key: "codex",
    });
    expect(services.providerRegistry.get("fake")).toMatchObject({
      key: "fake",
    });
    expect(services.providerRegistry.get("fake-tools")).toMatchObject({
      key: "fake-tools",
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
    removeTestDatabaseDirectory(join(process.cwd(), ".magick-test"));

    const custom = createBackendServices({ databasePath: customPath });
    expect(custom.databasePath).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);

    expect(resolveDefaultDatabasePath()).toBe(
      join(resolveBackendRepoRoot(), ".magick", "backend.db"),
    );

    removeTestDatabaseDirectory(join(process.cwd(), ".magick-test"));
  });

  it("resolves the default local workspace directory from the local home directory", () => {
    expect(
      resolveDefaultWorkspaceRoot({
        HOME: "/Users/tester",
      } as NodeJS.ProcessEnv),
    ).toBe("/Users/tester/Documents/magick");
  });

  it("resolves the default workspace root from the local home directory", () => {
    expect(resolveDefaultDatabasePath()).toBe(
      join(resolveBackendRepoRoot(), ".magick", "backend.db"),
    );
    expect(
      resolveDefaultWorkspaceRoot({
        HOME: "/Users/tester",
      } as NodeJS.ProcessEnv),
    ).toBe("/Users/tester/Documents/magick");
  });

  it("resolves the default workspace root from the XDG user dirs config", () => {
    const configRoot = mkdtempSync(join(process.cwd(), ".magick-test-xdg-"));

    try {
      writeFileSync(
        join(configRoot, "user-dirs.dirs"),
        'XDG_DOCUMENTS_DIR="$HOME/Localized Documents"\n',
        "utf8",
      );

      expect(
        resolveDefaultWorkspaceRoot({
          HOME: "/home/tester",
          XDG_CONFIG_HOME: configRoot,
        } as NodeJS.ProcessEnv),
      ).toBe("/home/tester/Localized Documents/magick");
    } finally {
      removeTestDatabaseDirectory(configRoot);
    }
  });

  it("persists bookmark renames across backend restarts", () => {
    const testDirectory = join(process.cwd(), ".magick-test-rename");
    const databasePath = join(testDirectory, "backend.db");
    removeTestDatabaseDirectory(testDirectory);

    const firstServices = createBackendServices({ databasePath });
    const createdBranch = firstServices.contextCore.createBookmark({
      providerKey: "codex",
      title: "Original chat",
    });

    firstServices.contextCore.renameBookmark({
      bookmarkId: createdBranch.bookmarkId,
      title: "Persisted rename",
    });

    const restartedServices = createBackendServices({ databasePath });
    const restartedBookmarks = restartedServices.contextCore.listBookmarks();
    const reopenedBranch = restartedServices.contextCore.selectBookmark({
      bookmarkId: createdBranch.bookmarkId,
    });

    expect(restartedBookmarks).toEqual([
      expect.objectContaining({
        bookmarkId: createdBranch.bookmarkId,
        title: "Persisted rename",
      }),
    ]);
    expect(reopenedBranch.title).toBe("Persisted rename");

    removeTestDatabaseDirectory(testDirectory);
  });

  it("persists bookmark deletions across backend restarts", () => {
    const testDirectory = join(process.cwd(), ".magick-test-delete");
    const databasePath = join(testDirectory, "backend.db");
    removeTestDatabaseDirectory(testDirectory);

    const firstServices = createBackendServices({ databasePath });
    const createdBranch = firstServices.contextCore.createBookmark({
      providerKey: "codex",
      title: "Disposable chat",
    });

    firstServices.contextCore.deleteBookmark({
      bookmarkId: createdBranch.bookmarkId,
    });

    const restartedServices = createBackendServices({ databasePath });
    const restartedBookmarks = restartedServices.contextCore.listBookmarks();

    expect(restartedBookmarks).toEqual([]);
    expect(() =>
      restartedServices.contextCore.selectBookmark({
        bookmarkId: createdBranch.bookmarkId,
      }),
    ).toThrowError(
      expect.objectContaining({
        entity: "bookmark",
        id: createdBranch.bookmarkId,
      }),
    );

    removeTestDatabaseDirectory(testDirectory);
  });
});
