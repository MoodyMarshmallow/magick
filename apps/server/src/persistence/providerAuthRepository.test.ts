// Verifies provider auth records can be persisted, loaded, and deleted.

import * as ManagedRuntime from "effect/ManagedRuntime";

import { createDatabase } from "./database";
import {
  ProviderAuthRepository,
  makeProviderAuthRepositoryLayer,
} from "./providerAuthRepository";

describe("ProviderAuthRepository", () => {
  it("persists, reads, and deletes provider auth records", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderAuthRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderAuthRepository);

    await runtime.runPromise(
      repository.upsert({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 123,
        accountId: "acct_1",
        email: "user@example.com",
        planType: "plus",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(await runtime.runPromise(repository.get("codex"))).toMatchObject({
      accountId: "acct_1",
      email: "user@example.com",
    });

    await runtime.runPromise(repository.delete("codex"));
    expect(await runtime.runPromise(repository.get("codex"))).toBeNull();
  });

  it("returns null for providers without stored auth", async () => {
    const runtime = ManagedRuntime.make(
      makeProviderAuthRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ProviderAuthRepository);

    expect(await runtime.runPromise(repository.get("missing"))).toBeNull();
  });
});
