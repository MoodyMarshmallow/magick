// Verifies provider auth records can be persisted, loaded, and deleted.

import { createDatabase } from "./database";
import { ProviderAuthRepositoryClient } from "./providerAuthRepository";

describe("ProviderAuthRepositoryClient", () => {
  it("persists, reads, and deletes provider auth records", () => {
    const repository = new ProviderAuthRepositoryClient(createDatabase());

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
    });

    expect(repository.get("codex")).toMatchObject({
      accountId: "acct_1",
      email: "user@example.com",
    });

    repository.delete("codex");
    expect(repository.get("codex")).toBeNull();
  });

  it("returns null for providers without stored auth", () => {
    const repository = new ProviderAuthRepositoryClient(createDatabase());

    expect(repository.get("missing")).toBeNull();
  });
});
