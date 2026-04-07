import { existsSync, rmSync } from "node:fs";
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

  it("resolves the default local workspace directory from the repo root", () => {
    expect(resolveDefaultWorkspaceRoot()).toBe(
      join(resolveBackendRepoRoot(), ".magick", "workspace"),
    );
  });

  it("resolves the default workspace root from the repo root instead of the package cwd", () => {
    expect(resolveDefaultDatabasePath()).toBe(
      join(resolveBackendRepoRoot(), ".magick", "backend.db"),
    );
    expect(resolveDefaultWorkspaceRoot()).toBe(
      join(resolveBackendRepoRoot(), ".magick", "workspace"),
    );
  });

  it("persists thread renames across backend restarts", async () => {
    const testDirectory = join(process.cwd(), ".magick-test-rename");
    const databasePath = join(testDirectory, "backend.db");
    removeTestDatabaseDirectory(testDirectory);

    const firstServices = createBackendServices({ databasePath });
    const createdThread = await firstServices.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: "codex",
      title: "Original chat",
    });

    await firstServices.threadOrchestrator.renameThread(
      createdThread.threadId,
      "Persisted rename",
    );

    const restartedServices = createBackendServices({ databasePath });
    const restartedThreads =
      await restartedServices.threadOrchestrator.listThreads("workspace_1");
    const reopenedThread =
      await restartedServices.threadOrchestrator.openThread(
        createdThread.threadId,
      );

    expect(restartedThreads).toEqual([
      expect.objectContaining({
        threadId: createdThread.threadId,
        title: "Persisted rename",
      }),
    ]);
    expect(reopenedThread.title).toBe("Persisted rename");

    removeTestDatabaseDirectory(testDirectory);
  });

  it("persists thread deletions across backend restarts", async () => {
    const testDirectory = join(process.cwd(), ".magick-test-delete");
    const databasePath = join(testDirectory, "backend.db");
    removeTestDatabaseDirectory(testDirectory);

    const firstServices = createBackendServices({ databasePath });
    const createdThread = await firstServices.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: "codex",
      title: "Disposable chat",
    });

    await firstServices.threadOrchestrator.deleteThread(createdThread.threadId);

    const restartedServices = createBackendServices({ databasePath });
    const restartedThreads =
      await restartedServices.threadOrchestrator.listThreads("workspace_1");

    expect(restartedThreads).toEqual([]);
    await expect(
      restartedServices.threadOrchestrator.openThread(createdThread.threadId),
    ).rejects.toMatchObject({
      entity: "thread",
      id: createdThread.threadId,
    });

    removeTestDatabaseDirectory(testDirectory);
  });
});
