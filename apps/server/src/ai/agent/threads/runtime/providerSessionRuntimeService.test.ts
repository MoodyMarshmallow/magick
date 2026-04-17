import { Cause, Effect, Exit, Option } from "effect";

import { createDatabase } from "../../../../persistence/database";
import { ProviderRegistry } from "../../providers/providerRegistry";
import type { ProviderSessionHandle } from "../../providers/providerTypes";
import { NotFoundError } from "../../runtime/errors";
import { createRuntimeState } from "../../runtime/runtime";
import { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import { createThreadRecord } from "../test-support/threadTestSupport";
import { ProviderSessionRuntimeService } from "./providerSessionRuntimeService";

describe("ProviderSessionRuntimeService", () => {
  it("returns a cached runtime without hitting the provider adapter again", async () => {
    const runtimeState = createRuntimeState();
    const createSession = vi.fn();
    const adapter = {
      key: "fake",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession,
      resumeSession: vi.fn(),
    };
    const cachedRuntime = {
      recordId: "session_1",
      adapter,
      session: {
        sessionId: "session_1",
        providerSessionRef: null,
        providerThreadRef: null,
        startTurn: vi.fn(),
        interruptTurn: vi.fn(),
        submitToolResult: vi.fn(),
        dispose: vi.fn(),
      } as unknown as ProviderSessionHandle,
    };
    runtimeState.setSessionRuntime("session_1", cachedRuntime);

    const service = new ProviderSessionRuntimeService({
      providerRegistry: new ProviderRegistry([adapter]),
      providerSessionRepository: new ProviderSessionRepository(
        createDatabase(),
      ),
      runtimeState,
      clock: { now: () => "2026-04-17T00:00:00.000Z" },
    });

    await expect(
      Effect.runPromise(
        service.getOrCreateSessionRuntime(createThreadRecord()),
      ),
    ).resolves.toBe(cachedRuntime);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a session when the stored record has no provider refs and updates refs when they change", async () => {
    const database = createDatabase();
    const repository = new ProviderSessionRepository(database);
    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: null,
      providerThreadRef: null,
      capabilities: {
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      },
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    });
    const createSession = vi.fn().mockReturnValue(
      Effect.succeed({
        sessionId: "session_1",
        providerSessionRef: "provider_session_1",
        providerThreadRef: "provider_thread_1",
        startTurn: vi.fn(),
        interruptTurn: vi.fn(),
        submitToolResult: vi.fn(),
        dispose: vi.fn(),
      } as unknown as ProviderSessionHandle),
    );
    const resumeSession = vi.fn();
    const adapter = {
      key: "fake",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession,
      resumeSession,
    };
    const service = new ProviderSessionRuntimeService({
      providerRegistry: new ProviderRegistry([adapter]),
      providerSessionRepository: repository,
      runtimeState: createRuntimeState(),
      clock: { now: () => "2026-04-17T00:00:01.000Z" },
    });

    const runtime = await Effect.runPromise(
      service.getOrCreateSessionRuntime(createThreadRecord()),
    );

    expect(createSession).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sessionId: "session_1",
    });
    expect(resumeSession).not.toHaveBeenCalled();
    expect(runtime.recordId).toBe("session_1");
    expect(repository.get("session_1")).toMatchObject({
      providerSessionRef: "provider_session_1",
      providerThreadRef: "provider_thread_1",
      updatedAt: "2026-04-17T00:00:01.000Z",
    });
  });

  it("resumes a session when provider refs already exist and fails when the session record is missing", async () => {
    const database = createDatabase();
    const repository = new ProviderSessionRepository(database);
    repository.create({
      id: "session_1",
      providerKey: "fake",
      workspaceId: "workspace_1",
      status: "active",
      providerSessionRef: "provider_session_1",
      providerThreadRef: "provider_thread_1",
      capabilities: {
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      },
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z",
    });
    const resumeSession = vi.fn().mockReturnValue(
      Effect.succeed({
        sessionId: "session_1",
        providerSessionRef: "provider_session_1",
        providerThreadRef: "provider_thread_1",
        startTurn: vi.fn(),
        interruptTurn: vi.fn(),
        submitToolResult: vi.fn(),
        dispose: vi.fn(),
      } as unknown as ProviderSessionHandle),
    );
    const adapter = {
      key: "fake",
      listCapabilities: () => ({
        supportsNativeResume: true,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: true,
      }),
      getResumeStrategy: () => "native" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession: vi.fn(),
      resumeSession,
    };
    const service = new ProviderSessionRuntimeService({
      providerRegistry: new ProviderRegistry([adapter]),
      providerSessionRepository: repository,
      runtimeState: createRuntimeState(),
      clock: { now: () => "2026-04-17T00:00:00.000Z" },
    });

    await expect(
      Effect.runPromise(
        service.getOrCreateSessionRuntime(createThreadRecord()),
      ),
    ).resolves.toMatchObject({ recordId: "session_1" });
    expect(resumeSession).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sessionId: "session_1",
      providerSessionRef: "provider_session_1",
      providerThreadRef: "provider_thread_1",
    });

    const missingSession = await Effect.runPromiseExit(
      service.getOrCreateSessionRuntime(
        createThreadRecord({ providerSessionId: "missing_session" }),
      ),
    );
    expect(Exit.isFailure(missingSession)).toBe(true);
    if (Exit.isFailure(missingSession)) {
      const failure = Cause.failureOption(missingSession.cause);
      expect(Option.isSome(failure) ? failure.value : null).toBeInstanceOf(
        NotFoundError,
      );
    }
  });
});
