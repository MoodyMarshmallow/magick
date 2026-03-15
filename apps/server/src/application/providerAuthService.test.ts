// Verifies provider auth service behavior and provider validation rules.

import { Cause, Effect, Exit, Option } from "effect";

import { createDatabase } from "../persistence/database";
import { ProviderAuthRepositoryClient } from "../persistence/providerAuthRepository";
import type { CodexAuthClient } from "../providers/codex/codexAuthClient";
import type { CodexOAuthHarness } from "../providers/codex/codexOAuth";
import {
  ProviderAuthService,
  ProviderAuthServiceLive,
} from "./providerAuthService";

const makeService = async (overrides?: {
  authRepository?: ProviderAuthRepositoryClient;
  authClient?: CodexAuthClient;
  oauthHarness?: CodexOAuthHarness;
}) => {
  return Effect.runPromise(
    ProviderAuthService.pipe(
      Effect.provide(
        ProviderAuthServiceLive({
          authRepository:
            overrides?.authRepository ??
            new ProviderAuthRepositoryClient(createDatabase()),
          ...(overrides?.authClient
            ? { authClient: overrides.authClient }
            : {}),
          ...(overrides?.oauthHarness
            ? { oauthHarness: overrides.oauthHarness }
            : {}),
        }),
      ),
    ),
  );
};

describe("ProviderAuthService", () => {
  it("fails for non-codex providers", async () => {
    const service = await makeService();

    const exit = await Effect.runPromiseExit(service.read("fake"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        _tag: "ProviderUnavailableError",
        providerKey: "fake",
      });
    }
  });

  it("returns unauthenticated state when no auth record exists", async () => {
    const service = await makeService();

    await expect(Effect.runPromise(service.read("codex"))).resolves.toEqual({
      providerKey: "codex",
      requiresOpenaiAuth: true,
      account: null,
      activeLoginId: null,
    });
  });

  it("refreshes expired auth records on read and returns account state", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
    await Effect.runPromise(
      authRepository.upsert({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "old_access",
        refreshToken: "old_refresh",
        expiresAt: Date.now() - 1,
        accountId: "acct_1",
        email: "old@example.com",
        planType: "plus",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    const authClient = {
      refreshAccessToken: vi.fn().mockReturnValue(
        Effect.succeed({
          accessToken: "new_access",
          refreshToken: "new_refresh",
          expiresAt: Date.now() + 60_000,
          accountId: "acct_2",
          email: "new@example.com",
        }),
      ),
    } as unknown as CodexAuthClient;

    const service = await makeService({ authRepository, authClient });

    await expect(Effect.runPromise(service.read("codex"))).resolves.toEqual({
      providerKey: "codex",
      requiresOpenaiAuth: true,
      account: {
        type: "chatgpt",
        email: "new@example.com",
        planType: "plus",
      },
      activeLoginId: null,
    });
  });

  it("starts and cancels a browser login flow", async () => {
    const oauthHarness = {
      startLogin: vi.fn().mockReturnValue(
        Effect.succeed({
          loginId: "login_1",
          authUrl: "https://chatgpt.com/login",
          redirectUri: "http://127.0.0.1:1455/auth/callback",
          codeVerifier: "verifier",
          waitForCode: () => new Promise<string>(() => {}),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    } as unknown as CodexOAuthHarness;

    const service = await makeService({ oauthHarness });

    const login = await Effect.runPromise(service.startChatGptLogin("codex"));
    expect(login).toEqual({
      providerKey: "codex",
      loginId: "login_1",
      authUrl: "https://chatgpt.com/login",
    });

    await Effect.runPromise(service.cancelLogin("codex", "login_1"));
  });

  it("logs out by clearing persisted auth state", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
    await Effect.runPromise(
      authRepository.upsert({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
        accountId: "acct_1",
        email: "user@example.com",
        planType: "plus",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    const service = await makeService({ authRepository });
    await Effect.runPromise(service.logout("codex"));

    expect(await Effect.runPromise(authRepository.get("codex"))).toBeNull();
  });

  it("completes a login flow and persists exchanged tokens", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
    const authClient = {
      exchangeAuthorizationCode: vi.fn().mockReturnValue(
        Effect.succeed({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 60_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      ),
      refreshAccessToken: vi.fn(),
    } as unknown as CodexAuthClient;
    const oauthHarness = {
      startLogin: vi.fn().mockReturnValue(
        Effect.succeed({
          loginId: "login_1",
          authUrl: "https://chatgpt.com/login",
          redirectUri: "http://127.0.0.1:1455/auth/callback",
          codeVerifier: "verifier",
          waitForCode: () => Promise.resolve("auth_code"),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    } as unknown as CodexOAuthHarness;

    const service = await makeService({
      authRepository,
      authClient,
      oauthHarness,
    });
    await Effect.runPromise(service.startChatGptLogin("codex"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await Effect.runPromise(authRepository.get("codex"))).toMatchObject({
      accessToken: "access",
      accountId: "acct_1",
      email: "user@example.com",
    });
  });

  it("fails when starting a second login while one is active and when canceling an unknown login", async () => {
    const deferred = new Promise<string>(() => {});
    const oauthHarness = {
      startLogin: vi.fn().mockReturnValue(
        Effect.succeed({
          loginId: "login_1",
          authUrl: "https://chatgpt.com/login",
          redirectUri: "http://127.0.0.1:1455/auth/callback",
          codeVerifier: "verifier",
          waitForCode: () => deferred,
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    } as unknown as CodexOAuthHarness;

    const service = await makeService({ oauthHarness });
    await Effect.runPromise(service.startChatGptLogin("codex"));

    await expect(
      Effect.runPromise(service.startChatGptLogin("codex")),
    ).rejects.toBeTruthy();
    await expect(
      Effect.runPromise(service.cancelLogin("codex", "missing")),
    ).rejects.toBeTruthy();
  });
});
