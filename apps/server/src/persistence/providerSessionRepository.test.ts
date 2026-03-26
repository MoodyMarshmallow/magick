// Verifies provider session records can be persisted and updated.

import { createDatabase } from "./database";
import { ProviderSessionRepository } from "./providerSessionRepository";

describe("ProviderSessionRepository", () => {
  it("persists and updates provider session records", () => {
    const repository = new ProviderSessionRepository(createDatabase());

    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: null,
      providerThreadRef: null,
      capabilities: {
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    repository.updateStatus(
      "session_1",
      "disconnected",
      "2026-01-01T00:00:01.000Z",
    );

    expect(repository.get("session_1")).toMatchObject({
      status: "disconnected",
    });
  });

  it("updates native provider refs and returns null for unknown sessions", () => {
    const repository = new ProviderSessionRepository(createDatabase());

    expect(repository.get("missing")).toBeNull();

    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: null,
      providerThreadRef: null,
      capabilities: {
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    repository.updateRefs("session_1", {
      providerSessionRef: "native_session",
      providerThreadRef: "native_thread",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });

    expect(repository.get("session_1")).toMatchObject({
      providerSessionRef: "native_session",
      providerThreadRef: "native_thread",
    });
  });

  it("allows status updates before refs are written", () => {
    const repository = new ProviderSessionRepository(createDatabase());

    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: null,
      providerThreadRef: null,
      capabilities: {
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    repository.updateStatus(
      "session_1",
      "disposed",
      "2026-01-01T00:00:02.000Z",
    );

    expect(repository.get("session_1")).toMatchObject({
      status: "disposed",
    });
  });

  it("can update status and refs independently on the same session", () => {
    const repository = new ProviderSessionRepository(createDatabase());

    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: "initial_session",
      providerThreadRef: "initial_thread",
      capabilities: {
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    repository.updateRefs("session_1", {
      providerSessionRef: "updated_session",
      providerThreadRef: "updated_thread",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    repository.updateStatus("session_1", "active", "2026-01-01T00:00:02.000Z");

    expect(repository.get("session_1")).toMatchObject({
      providerSessionRef: "updated_session",
      providerThreadRef: "updated_thread",
      status: "active",
    });
  });

  it("surfaces persistence errors when stored session payloads are invalid", () => {
    const database = createDatabase();
    database
      .prepare(
        `
          INSERT INTO provider_sessions (
            id,
            provider_key,
            workspace_id,
            status,
            provider_session_ref,
            provider_thread_ref,
            capabilities_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "session_1",
        "fake",
        "workspace_1",
        "active",
        null,
        null,
        "{bad json",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );

    const repository = new ProviderSessionRepository(database);

    expect(() => repository.get("session_1")).toThrow();
  });
});
