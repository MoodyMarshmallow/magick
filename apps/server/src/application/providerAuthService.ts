// Owns provider auth state, browser login flow tracking, refresh checks, and logout behavior.

import type {
  ProviderAuthLoginStartResult,
  ProviderAuthRecord,
  ProviderAuthState,
  ProviderKey,
} from "@magick/contracts/provider";
import { nowIso } from "@magick/shared/time";
import { InvalidStateError, ProviderUnavailableError } from "../core/errors";
import type { ProviderAuthRepositoryClient } from "../persistence/providerAuthRepository";
import {
  CodexAuthClient,
  type CodexAuthClientOptions,
} from "../providers/codex/codexAuthClient";
import {
  CodexOAuthHarness,
  type CodexOAuthHarnessOptions,
  type CodexOAuthLogin,
} from "../providers/codex/codexOAuth";

const REFRESH_SAFETY_MARGIN_MS = 60_000;

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
}

export class ProviderAuthService implements ProviderAuthServiceApi {
  readonly #authRepository: ProviderAuthRepositoryClient;
  readonly #authClient: CodexAuthClient;
  readonly #oauthHarness: CodexOAuthHarness;
  readonly #activeLogins = new Map<
    string,
    {
      readonly providerKey: ProviderKey;
      readonly login: CodexOAuthLogin;
    }
  >();
  readonly #listeners = new Set<
    (auth: ProviderAuthState) => void | Promise<void>
  >();

  constructor(options: ProviderAuthServiceOptions) {
    this.#authRepository = options.authRepository;
    this.#authClient =
      options.authClient ?? new CodexAuthClient(options.authClientOptions);
    this.#oauthHarness =
      options.oauthHarness ??
      new CodexOAuthHarness(options.oauthHarnessOptions);
  }

  #activeLoginIdForProvider(providerKey: ProviderKey): string | null {
    for (const [loginId, login] of this.#activeLogins.entries()) {
      if (login.providerKey === providerKey) {
        return loginId;
      }
    }

    return null;
  }

  #unauthenticatedState(
    providerKey: ProviderKey,
    activeLoginId: string | null,
  ): ProviderAuthState {
    return {
      providerKey,
      requiresOpenaiAuth: providerKey === "codex",
      account: null,
      activeLoginId,
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
    const activeLoginId = this.#activeLoginIdForProvider(providerKey);
    const record = this.#authRepository.get(providerKey);
    if (!record) {
      return this.#unauthenticatedState(providerKey, activeLoginId);
    }

    const refreshed = await this.#refreshIfNeeded(record, refreshToken);
    if (!refreshed) {
      return this.#unauthenticatedState(providerKey, activeLoginId);
    }

    return {
      providerKey,
      requiresOpenaiAuth: true,
      account: {
        type: "chatgpt",
        email: refreshed.email,
        planType: refreshed.planType,
      },
      activeLoginId,
    };
  }

  async startChatGptLogin(
    providerKey: ProviderKey,
  ): Promise<ProviderAuthLoginStartResult> {
    this.#assertCodexProvider(providerKey);
    const existing = this.#activeLoginIdForProvider(providerKey);
    if (existing) {
      throw new InvalidStateError({
        code: "provider_login_in_progress",
        detail: `Provider '${providerKey}' already has a login flow in progress.`,
      });
    }

    const login = await this.#oauthHarness.startLogin();
    this.#activeLogins.set(login.loginId, { providerKey, login });
    await this.#emit(providerKey);

    void (async () => {
      try {
        const code = await login.waitForCode();
        const tokens = await this.#authClient.exchangeAuthorizationCode(
          code,
          login.redirectUri,
          login.codeVerifier,
        );
        this.#persistTokens(tokens);
      } catch {
        // Browser login failure only affects the active flow; callers can observe it through state.
      } finally {
        this.#activeLogins.delete(login.loginId);
        await this.#emit(providerKey);
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

    this.#activeLogins.delete(loginId);
    await this.#emit(providerKey);
  }

  async logout(providerKey: ProviderKey): Promise<void> {
    this.#assertCodexProvider(providerKey);
    const activeLoginId = this.#activeLoginIdForProvider(providerKey);
    if (activeLoginId) {
      const login = this.#activeLogins.get(activeLoginId);
      if (login) {
        await login.login.cancel().catch(() => undefined);
      }
      this.#activeLogins.delete(activeLoginId);
    }

    this.#authRepository.delete(providerKey);
    await this.#emit(providerKey);
  }
}
