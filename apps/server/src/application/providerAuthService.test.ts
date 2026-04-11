// Verifies provider auth service behavior and provider validation rules.

import { createDatabase } from "../persistence/database";
import { ProviderAuthRepositoryClient } from "../persistence/providerAuthRepository";
import type { CodexAuthClient } from "../providers/codex/codexAuthClient";
import type { CodexOAuthHarness } from "../providers/codex/codexOAuth";
import { ProviderAuthService } from "./providerAuthService";

const makeService = (overrides?: {
  authRepository?: ProviderAuthRepositoryClient;
  authClient?: CodexAuthClient;
  oauthHarness?: CodexOAuthHarness;
  loginExpiryMs?: number;
}) => {
  return new ProviderAuthService({
    authRepository:
      overrides?.authRepository ??
      new ProviderAuthRepositoryClient(createDatabase()),
    ...(overrides?.authClient ? { authClient: overrides.authClient } : {}),
    ...(overrides?.oauthHarness
      ? { oauthHarness: overrides.oauthHarness }
      : {}),
    ...(overrides?.loginExpiryMs
      ? { loginExpiryMs: overrides.loginExpiryMs }
      : {}),
  });
};

const idleLoginState = {
  status: "idle",
  loginId: null,
  authUrl: null,
  startedAt: null,
  expiresAt: null,
  error: null,
} as const;

describe("ProviderAuthService", () => {
  it("fails for non-codex providers", async () => {
    const service = makeService();

    await expect(service.read("fake")).rejects.toMatchObject({
      _tag: "ProviderUnavailableError",
      providerKey: "fake",
    });
  });

  it("returns unauthenticated state when no auth record exists", async () => {
    const service = makeService();

    await expect(service.read("codex")).resolves.toEqual({
      providerKey: "codex",
      requiresOpenaiAuth: true,
      account: null,
      login: idleLoginState,
    });
  });

  it("refreshes expired auth records on read and returns account state", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
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
    });

    const authClient = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: "new_access",
        refreshToken: "new_refresh",
        expiresAt: Date.now() + 60_000,
        accountId: "acct_2",
        email: "new@example.com",
      }),
    } as unknown as CodexAuthClient;

    const service = makeService({ authRepository, authClient });

    await expect(service.read("codex")).resolves.toEqual({
      providerKey: "codex",
      requiresOpenaiAuth: true,
      account: {
        type: "chatgpt",
        email: "new@example.com",
        planType: "plus",
      },
      login: idleLoginState,
    });
  });

  it("starts and cancels a browser login flow", async () => {
    const oauthHarness = {
      startLogin: vi.fn().mockResolvedValue({
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        codeVerifier: "verifier",
        waitForCode: () => new Promise<string>(() => {}),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as CodexOAuthHarness;

    const service = makeService({ oauthHarness });

    const login = await service.startChatGptLogin("codex");
    expect(login).toEqual({
      providerKey: "codex",
      loginId: "login_1",
      authUrl: "https://chatgpt.com/login",
    });

    await expect(service.read("codex")).resolves.toMatchObject({
      login: {
        status: "pending",
        loginId: "login_1",
      },
    });

    await service.cancelLogin("codex", "login_1");

    await expect(service.read("codex")).resolves.toMatchObject({
      login: {
        status: "cancelled",
        loginId: "login_1",
      },
    });
  });

  it("logs out by clearing persisted auth state", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
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
    });

    const service = makeService({ authRepository });
    await service.logout("codex");

    expect(authRepository.get("codex")).toBeNull();
  });

  it("completes a login flow and persists exchanged tokens", async () => {
    const authRepository = new ProviderAuthRepositoryClient(createDatabase());
    const authClient = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: "acct_1",
        email: "user@example.com",
      }),
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: "acct_1",
        email: "user@example.com",
      }),
    } as unknown as CodexAuthClient;
    const oauthHarness = {
      startLogin: vi.fn().mockResolvedValue({
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        codeVerifier: "verifier",
        waitForCode: () => Promise.resolve("auth_code"),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as CodexOAuthHarness;

    const service = makeService({
      authRepository,
      authClient,
      oauthHarness,
    });
    await service.startChatGptLogin("codex");
    await vi.waitFor(() => {
      expect(authRepository.get("codex")).toMatchObject({
        accessToken: "access",
        accountId: "acct_1",
        email: "user@example.com",
      });
    });
  });

  it("returns the existing login when starting again while one is pending and still fails for unknown login cancellation", async () => {
    const deferred = new Promise<string>(() => {});
    const oauthHarness = {
      startLogin: vi.fn().mockResolvedValue({
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        codeVerifier: "verifier",
        waitForCode: () => deferred,
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as CodexOAuthHarness;

    const service = makeService({ oauthHarness });
    await service.startChatGptLogin("codex");

    await expect(service.startChatGptLogin("codex")).resolves.toEqual({
      providerKey: "codex",
      loginId: "login_1",
      authUrl: "https://chatgpt.com/login",
    });
    await expect(service.cancelLogin("codex", "missing")).rejects.toBeTruthy();
  });

  it("expires an unfinished login and returns to a retryable auth state", async () => {
    vi.useFakeTimers();
    const oauthHarness = {
      startLogin: vi.fn().mockResolvedValue({
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        codeVerifier: "verifier",
        waitForCode: () => new Promise<string>(() => {}),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as CodexOAuthHarness;

    const service = makeService({ oauthHarness, loginExpiryMs: 1000 });
    await service.startChatGptLogin("codex");

    await vi.advanceTimersByTimeAsync(1000);

    await expect(service.read("codex")).resolves.toMatchObject({
      login: {
        status: "expired",
        loginId: "login_1",
      },
    });
    vi.useRealTimers();
  });

  it("does not fail auth mutations when a subscriber rejects", async () => {
    const oauthHarness = {
      startLogin: vi.fn().mockResolvedValue({
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        codeVerifier: "verifier",
        waitForCode: () => new Promise<string>(() => {}),
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as CodexOAuthHarness;

    const service = makeService({ oauthHarness });
    service.subscribe(async () => {
      throw new Error("listener failure");
    });

    await expect(service.startChatGptLogin("codex")).resolves.toEqual({
      providerKey: "codex",
      loginId: "login_1",
      authUrl: "https://chatgpt.com/login",
    });
    await expect(
      service.cancelLogin("codex", "login_1"),
    ).resolves.toBeUndefined();
  });
});
