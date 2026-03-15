// Verifies provider session records can be persisted and updated.

import * as ManagedRuntime from "effect/ManagedRuntime";

import { createDatabase } from "./database";
import {
  ProviderSessionRepository,
  makeProviderSessionRepositoryLayer,
} from "./providerSessionRepository";

describe("ProviderSessionRepository", () => {
  it("persists and updates provider session records", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderSessionRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderSessionRepository);

    await runtime.runPromise(
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
      }),
    );

    await runtime.runPromise(
      repository.updateStatus(
        "session_1",
        "disconnected",
        "2026-01-01T00:00:01.000Z",
      ),
    );

    expect(await runtime.runPromise(repository.get("session_1"))).toMatchObject(
      {
        status: "disconnected",
      },
    );
  });

  it("updates native provider refs and returns null for unknown sessions", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderSessionRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderSessionRepository);

    expect(await runtime.runPromise(repository.get("missing"))).toBeNull();

    await runtime.runPromise(
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
      }),
    );

    await runtime.runPromise(
      repository.updateRefs("session_1", {
        providerSessionRef: "native_session",
        providerThreadRef: "native_thread",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    expect(await runtime.runPromise(repository.get("session_1"))).toMatchObject(
      {
        providerSessionRef: "native_session",
        providerThreadRef: "native_thread",
      },
    );
  });

  it("allows status updates before refs are written", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderSessionRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderSessionRepository);

    await runtime.runPromise(
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
      }),
    );

    await runtime.runPromise(
      repository.updateStatus(
        "session_1",
        "disposed",
        "2026-01-01T00:00:02.000Z",
      ),
    );

    expect(await runtime.runPromise(repository.get("session_1"))).toMatchObject(
      {
        status: "disposed",
      },
    );
  });

  it("can update status and refs independently on the same session", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderSessionRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderSessionRepository);

    await runtime.runPromise(
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
      }),
    );

    await runtime.runPromise(
      repository.updateRefs("session_1", {
        providerSessionRef: "updated_session",
        providerThreadRef: "updated_thread",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await runtime.runPromise(
      repository.updateStatus(
        "session_1",
        "active",
        "2026-01-01T00:00:02.000Z",
      ),
    );

    expect(await runtime.runPromise(repository.get("session_1"))).toMatchObject(
      {
        providerSessionRef: "updated_session",
        providerThreadRef: "updated_thread",
        status: "active",
      },
    );
  });

  it("surfaces persistence errors when stored session payloads are invalid", async () => {
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

    const runtime = ManagedRuntime.make(
      makeProviderSessionRepositoryLayer(database),
    );
    const repository = await runtime.runPromise(ProviderSessionRepository);

    await expect(
      runtime.runPromise(repository.get("session_1")),
    ).rejects.toBeTruthy();
  });
});
