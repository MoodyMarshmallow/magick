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
});
