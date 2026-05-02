// Owns provider auth state, browser login flow tracking, refresh checks, and logout behavior.

import type {
  ProviderAuthLoginStartResult,
  ProviderAuthLoginState,
  ProviderAuthRecord,
  ProviderAuthState,
  ProviderKey,
} from "@magick/contracts/provider";
import { nowIso } from "@magick/shared/time";
import {
  InvalidStateError,
  ProviderUnavailableError,
} from "../agent/shared/errors";
import {
  CodexAuthClient,
  type CodexAuthClientOptions,
} from "./codex/codexAuthClient";
import {
  CodexOAuthHarness,
  type CodexOAuthHarnessOptions,
  type CodexOAuthLogin,
} from "./codex/codexOAuth";
import type { ProviderAuthRepositoryClient } from "./providerAuthRepository";

const REFRESH_SAFETY_MARGIN_MS = 60_000;
const LOGIN_EXPIRY_MS = 5 * 60_000;

export interface ProviderAuthServiceApi {
  readonly read: (
    providerKey: ProviderKey,
    refreshToken?: boolean,
  ) => Promise<ProviderAuthState>;
  readonly startChatGptLogin: (
    providerKey: ProviderKey,
  ) => Promise<ProviderAuthLoginStartResult>;
  readonly cancelLogin: (
    providerKey: ProviderKey,
    loginId: string,
  ) => Promise<void>;
  readonly logout: (providerKey: ProviderKey) => Promise<void>;
  readonly subscribe: (
    listener: (auth: ProviderAuthState) => void | Promise<void>,
  ) => () => void;
}

interface ProviderAuthServiceOptions {
  readonly authRepository: ProviderAuthRepositoryClient;
  readonly authClient?: CodexAuthClient;
  readonly authClientOptions?: CodexAuthClientOptions;
  readonly oauthHarness?: CodexOAuthHarness;
  readonly oauthHarnessOptions?: CodexOAuthHarnessOptions;
  readonly loginExpiryMs?: number;
}

interface ActiveLoginEntry {
  readonly providerKey: ProviderKey;
  readonly login: CodexOAuthLogin;
  readonly startedAt: string;
  readonly expiresAt: string;
}

export class ProviderAuthService implements ProviderAuthServiceApi {
  readonly #authRepository: ProviderAuthRepositoryClient;
  readonly #authClient: CodexAuthClient;
  readonly #oauthHarness: CodexOAuthHarness;
  readonly #activeLogins = new Map<string, ActiveLoginEntry>();
  readonly #loginStateByProvider = new Map<
    ProviderKey,
    ProviderAuthLoginState
  >();
  readonly #loginExpiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  readonly #listeners = new Set<
    (auth: ProviderAuthState) => void | Promise<void>
  >();
  readonly #loginExpiryMs: number;

  constructor(options: ProviderAuthServiceOptions) {
    this.#authRepository = options.authRepository;
    this.#authClient =
      options.authClient ?? new CodexAuthClient(options.authClientOptions);
    this.#oauthHarness =
      options.oauthHarness ??
      new CodexOAuthHarness(options.oauthHarnessOptions);
    this.#loginExpiryMs = options.loginExpiryMs ?? LOGIN_EXPIRY_MS;
  }

  #activeLoginForProvider(providerKey: ProviderKey): ActiveLoginEntry | null {
    for (const login of this.#activeLogins.values()) {
      if (login.providerKey === providerKey) {
        return login;
      }
    }

    return null;
  }

  #idleLoginState(): ProviderAuthLoginState {
    return {
      status: "idle",
      loginId: null,
      authUrl: null,
      startedAt: null,
      expiresAt: null,
      error: null,
    };
  }

  #pendingLoginState(login: ActiveLoginEntry): ProviderAuthLoginState {
    return {
      status: "pending",
      loginId: login.login.loginId,
      authUrl: login.login.authUrl,
      startedAt: login.startedAt,
      expiresAt: login.expiresAt,
      error: null,
    };
  }

  #terminalLoginState(args: {
    readonly status: "cancelled" | "failed" | "expired";
    readonly loginId: string;
    readonly startedAt: string;
    readonly expiresAt: string;
    readonly error?: string | null;
  }): ProviderAuthLoginState {
    return {
      status: args.status,
      loginId: args.loginId,
      authUrl: null,
      startedAt: args.startedAt,
      expiresAt: args.expiresAt,
      error: args.error ?? null,
    };
  }

  #setLoginState(
    providerKey: ProviderKey,
    state: ProviderAuthLoginState,
  ): void {
    this.#loginStateByProvider.set(providerKey, state);
  }

  #currentLoginState(providerKey: ProviderKey): ProviderAuthLoginState {
    const activeLogin = this.#activeLoginForProvider(providerKey);
    if (activeLogin) {
      return this.#pendingLoginState(activeLogin);
    }

    return (
      this.#loginStateByProvider.get(providerKey) ?? this.#idleLoginState()
    );
  }

  #clearLoginTimer(loginId: string): void {
    const timer = this.#loginExpiryTimers.get(loginId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.#loginExpiryTimers.delete(loginId);
  }

  async #finishLogin(args: {
    readonly loginId: string;
    readonly nextState: ProviderAuthLoginState;
  }): Promise<boolean> {
    const activeLogin = this.#activeLogins.get(args.loginId);
    if (!activeLogin) {
      return false;
    }

    this.#clearLoginTimer(args.loginId);
    this.#activeLogins.delete(args.loginId);
    this.#setLoginState(activeLogin.providerKey, args.nextState);
    await this.#emit(activeLogin.providerKey);
    return true;
  }

  #scheduleLoginExpiry(login: ActiveLoginEntry): void {
    this.#clearLoginTimer(login.login.loginId);
    this.#loginExpiryTimers.set(
      login.login.loginId,
      setTimeout(() => {
        void (async () => {
          const activeLogin = this.#activeLogins.get(login.login.loginId);
          if (!activeLogin) {
            return;
          }

          await activeLogin.login.cancel().catch(() => undefined);
          await this.#finishLogin({
            loginId: login.login.loginId,
            nextState: this.#terminalLoginState({
              status: "expired",
              loginId: login.login.loginId,
              startedAt: activeLogin.startedAt,
              expiresAt: activeLogin.expiresAt,
              error: "Login expired before completion.",
            }),
          });
        })();
      }, this.#loginExpiryMs),
    );
  }

  #unauthenticatedState(providerKey: ProviderKey): ProviderAuthState {
    return {
      providerKey,
      requiresOpenaiAuth: providerKey === "codex",
      account: null,
      login: this.#currentLoginState(providerKey),
    };
  }

  #assertCodexProvider(providerKey: ProviderKey): void {
    if (providerKey !== "codex") {
      throw new ProviderUnavailableError({ providerKey: String(providerKey) });
    }
  }

  async #emit(providerKey: ProviderKey): Promise<void> {
    const auth = await this.read(providerKey);
    await Promise.allSettled(
      [...this.#listeners].map((listener) => Promise.resolve(listener(auth))),
    );
  }

  #persistTokens(tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresAt: number;
    readonly accountId: string | null;
    readonly email: string | null;
    readonly planType?: string | null;
  }): ProviderAuthRecord {
    const timestamp = nowIso();
    const record: ProviderAuthRecord = {
      providerKey: "codex",
      authMode: "chatgpt",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      accountId: tokens.accountId,
      email: tokens.email,
      planType: tokens.planType ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#authRepository.upsert(record);
    return record;
  }

  async #refreshIfNeeded(
    record: ProviderAuthRecord,
    forceRefresh: boolean,
  ): Promise<ProviderAuthRecord | null> {
    if (
      !forceRefresh &&
      record.expiresAt > Date.now() + REFRESH_SAFETY_MARGIN_MS
    ) {
      return record;
    }

    try {
      const tokens = await this.#authClient.refreshAccessToken(
        record.refreshToken,
      );
      const refreshed: ProviderAuthRecord = {
        ...record,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        accountId: tokens.accountId,
        email: tokens.email,
        updatedAt: nowIso(),
      };
      this.#authRepository.upsert(refreshed);
      return refreshed;
    } catch {
      this.#authRepository.delete("codex");
      void this.#emit("codex");
      return null;
    }
  }

  subscribe(
    listener: (auth: ProviderAuthState) => void | Promise<void>,
  ): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async read(
    providerKey: ProviderKey,
    refreshToken = false,
  ): Promise<ProviderAuthState> {
    this.#assertCodexProvider(providerKey);
    const record = this.#authRepository.get(providerKey);
    if (!record) {
      return this.#unauthenticatedState(providerKey);
    }

    const refreshed = await this.#refreshIfNeeded(record, refreshToken);
    if (!refreshed) {
      return this.#unauthenticatedState(providerKey);
    }

    return {
      providerKey,
      requiresOpenaiAuth: true,
      account: {
        type: "chatgpt",
        email: refreshed.email,
        planType: refreshed.planType,
      },
      login: this.#currentLoginState(providerKey),
    };
  }

  async startChatGptLogin(
    providerKey: ProviderKey,
  ): Promise<ProviderAuthLoginStartResult> {
    this.#assertCodexProvider(providerKey);
    const existing = this.#activeLoginForProvider(providerKey);
    if (existing) {
      return {
        providerKey,
        loginId: existing.login.loginId,
        authUrl: existing.login.authUrl,
      };
    }

    const login = await this.#oauthHarness.startLogin();
    const startedAt = nowIso();
    const expiresAt = new Date(Date.now() + this.#loginExpiryMs).toISOString();
    const activeLogin: ActiveLoginEntry = {
      providerKey,
      login,
      startedAt,
      expiresAt,
    };
    this.#activeLogins.set(login.loginId, activeLogin);
    this.#setLoginState(providerKey, this.#pendingLoginState(activeLogin));
    this.#scheduleLoginExpiry(activeLogin);
    await this.#emit(providerKey);

    void (async () => {
      try {
        const code = await login.waitForCode();
        const currentLogin = this.#activeLogins.get(login.loginId);
        if (!currentLogin) {
          return;
        }
        const tokens = await this.#authClient.exchangeAuthorizationCode(
          code,
          login.redirectUri,
          login.codeVerifier,
        );
        this.#persistTokens(tokens);
        await this.#finishLogin({
          loginId: login.loginId,
          nextState: this.#idleLoginState(),
        });
      } catch (error) {
        const currentLogin = this.#activeLogins.get(login.loginId);
        if (!currentLogin) {
          return;
        }
        await this.#finishLogin({
          loginId: login.loginId,
          nextState: this.#terminalLoginState({
            status: "failed",
            loginId: login.loginId,
            startedAt: currentLogin.startedAt,
            expiresAt: currentLogin.expiresAt,
            error:
              error instanceof Error
                ? error.message
                : "Login failed before completion.",
          }),
        });
      } finally {
        this.#clearLoginTimer(login.loginId);
      }
    })();

    return {
      providerKey,
      loginId: login.loginId,
      authUrl: login.authUrl,
    };
  }

  async cancelLogin(providerKey: ProviderKey, loginId: string): Promise<void> {
    this.#assertCodexProvider(providerKey);
    const login = this.#activeLogins.get(loginId);
    if (!login || login.providerKey !== providerKey) {
      throw new InvalidStateError({
        code: "provider_login_not_found",
        detail: `No active login '${loginId}' for provider '${providerKey}'.`,
      });
    }

    try {
      await login.login.cancel();
    } catch (error) {
      throw new InvalidStateError({
        code: "provider_login_cancel_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    await this.#finishLogin({
      loginId,
      nextState: this.#terminalLoginState({
        status: "cancelled",
        loginId,
        startedAt: login.startedAt,
        expiresAt: login.expiresAt,
        error: "Login cancelled.",
      }),
    });
  }

  async logout(providerKey: ProviderKey): Promise<void> {
    this.#assertCodexProvider(providerKey);
    const activeLogin = this.#activeLoginForProvider(providerKey);
    if (activeLogin) {
      const login = this.#activeLogins.get(activeLogin.login.loginId);
      if (login) {
        await login.login.cancel().catch(() => undefined);
      }
      this.#clearLoginTimer(activeLogin.login.loginId);
      this.#activeLogins.delete(activeLogin.login.loginId);
    }

    this.#setLoginState(providerKey, this.#idleLoginState());
    this.#authRepository.delete(providerKey);
    await this.#emit(providerKey);
  }
}
