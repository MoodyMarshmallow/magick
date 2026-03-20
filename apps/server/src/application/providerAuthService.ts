// Owns provider auth state, browser login flow tracking, refresh checks, and logout behavior.

import { Context, Effect, Layer, Ref } from "effect";

import type {
  ProviderAuthLoginStartResult,
  ProviderAuthRecord,
  ProviderAuthState,
  ProviderKey,
} from "@magick/contracts/provider";
import { nowIso } from "@magick/shared/time";
import {
  type BackendError,
  InvalidStateError,
  ProviderUnavailableError,
} from "../effect/errors";
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
  ) => Effect.Effect<ProviderAuthState, BackendError>;
  readonly startChatGptLogin: (
    providerKey: ProviderKey,
  ) => Effect.Effect<ProviderAuthLoginStartResult, BackendError>;
  readonly cancelLogin: (
    providerKey: ProviderKey,
    loginId: string,
  ) => Effect.Effect<void, BackendError>;
  readonly logout: (
    providerKey: ProviderKey,
  ) => Effect.Effect<void, BackendError>;
}

export const ProviderAuthService = Context.GenericTag<ProviderAuthServiceApi>(
  "@magick/ProviderAuthService",
);

export interface ProviderAuthServiceOptions {
  readonly authRepository: ProviderAuthRepositoryClient;
  readonly authClient?: CodexAuthClient;
  readonly authClientOptions?: CodexAuthClientOptions;
  readonly oauthHarness?: CodexOAuthHarness;
  readonly oauthHarnessOptions?: CodexOAuthHarnessOptions;
}

export const ProviderAuthServiceLive = (
  options: ProviderAuthServiceOptions,
) => {
  const authRepository = options.authRepository;
  const authClient =
    options.authClient ?? new CodexAuthClient(options.authClientOptions);
  const oauthHarness =
    options.oauthHarness ?? new CodexOAuthHarness(options.oauthHarnessOptions);

  return Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const activeLogins = yield* Ref.make(
        new Map<
          string,
          {
            readonly providerKey: ProviderKey;
            readonly login: CodexOAuthLogin;
          }
        >(),
      );

      const activeLoginIdForProvider = (providerKey: ProviderKey) =>
        Ref.get(activeLogins).pipe(
          Effect.map((logins) => {
            for (const [loginId, login] of logins.entries()) {
              if (login.providerKey === providerKey) {
                return loginId;
              }
            }

            return null;
          }),
        );

      const unauthenticatedState = (
        providerKey: ProviderKey,
        activeLoginId: string | null,
      ): ProviderAuthState => ({
        providerKey,
        requiresOpenaiAuth: providerKey === "codex",
        account: null,
        activeLoginId,
      });

      const assertCodexProvider = (providerKey: ProviderKey) => {
        if (providerKey !== "codex") {
          return Effect.fail(
            new ProviderUnavailableError({ providerKey: String(providerKey) }),
          );
        }

        return Effect.void;
      };

      const persistTokens = (tokens: {
        readonly accessToken: string;
        readonly refreshToken: string;
        readonly expiresAt: number;
        readonly accountId: string | null;
        readonly email: string | null;
        readonly planType?: string | null;
      }) => {
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

        return authRepository.upsert(record).pipe(Effect.as(record));
      };

      const refreshIfNeeded = (
        record: ProviderAuthRecord,
        forceRefresh: boolean,
      ) => {
        if (
          !forceRefresh &&
          record.expiresAt > Date.now() + REFRESH_SAFETY_MARGIN_MS
        ) {
          return Effect.succeed(record);
        }

        return authClient.refreshAccessToken(record.refreshToken).pipe(
          Effect.flatMap((tokens) =>
            authRepository
              .upsert({
                ...record,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                accountId: tokens.accountId,
                email: tokens.email,
                updatedAt: nowIso(),
              })
              .pipe(
                Effect.as({
                  ...record,
                  accessToken: tokens.accessToken,
                  refreshToken: tokens.refreshToken,
                  expiresAt: tokens.expiresAt,
                  accountId: tokens.accountId,
                  email: tokens.email,
                  updatedAt: nowIso(),
                }),
              ),
          ),
          Effect.catchAll(() =>
            authRepository.delete("codex").pipe(Effect.as(null)),
          ),
        );
      };

      return {
        read: (providerKey: ProviderKey, refreshToken = false) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const activeLoginId = yield* activeLoginIdForProvider(providerKey);
            const record = yield* authRepository.get(providerKey);
            if (!record) {
              return unauthenticatedState(providerKey, activeLoginId);
            }

            const refreshed = yield* refreshIfNeeded(record, refreshToken);
            if (!refreshed) {
              return unauthenticatedState(providerKey, activeLoginId);
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
            } satisfies ProviderAuthState;
          }),
        startChatGptLogin: (providerKey: ProviderKey) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const existing = yield* activeLoginIdForProvider(providerKey);
            if (existing) {
              return yield* Effect.fail(
                new InvalidStateError({
                  code: "provider_login_in_progress",
                  detail: `Provider '${providerKey}' already has a login flow in progress.`,
                }),
              );
            }

            const login = yield* oauthHarness.startLogin();
            yield* Ref.update(activeLogins, (logins) => {
              const next = new Map(logins);
              next.set(login.loginId, { providerKey, login });
              return next;
            });

            void Effect.runFork(
              Effect.tryPromise({
                try: () => login.waitForCode(),
                catch: (error) =>
                  new InvalidStateError({
                    code: "provider_login_failed",
                    detail:
                      error instanceof Error ? error.message : String(error),
                  }),
              }).pipe(
                Effect.flatMap((code) =>
                  authClient.exchangeAuthorizationCode(
                    code,
                    login.redirectUri,
                    login.codeVerifier,
                  ),
                ),
                Effect.flatMap((tokens) => persistTokens(tokens)),
                Effect.catchAll(() => Effect.void),
                Effect.ensuring(
                  Ref.update(activeLogins, (logins) => {
                    const next = new Map(logins);
                    next.delete(login.loginId);
                    return next;
                  }),
                ),
              ),
            );

            return {
              providerKey,
              loginId: login.loginId,
              authUrl: login.authUrl,
            } satisfies ProviderAuthLoginStartResult;
          }),
        cancelLogin: (providerKey: ProviderKey, loginId: string) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const login = yield* Ref.get(activeLogins).pipe(
              Effect.map((logins) => logins.get(loginId)),
            );
            if (!login || login.providerKey !== providerKey) {
              return yield* Effect.fail(
                new InvalidStateError({
                  code: "provider_login_not_found",
                  detail: `No active login '${loginId}' for provider '${providerKey}'.`,
                }),
              );
            }

            yield* Effect.tryPromise({
              try: () => login.login.cancel(),
              catch: (error) =>
                new InvalidStateError({
                  code: "provider_login_cancel_failed",
                  detail:
                    error instanceof Error ? error.message : String(error),
                }),
            });
            yield* Ref.update(activeLogins, (logins) => {
              const next = new Map(logins);
              next.delete(loginId);
              return next;
            });
          }),
        logout: (providerKey: ProviderKey) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const activeLoginId = yield* activeLoginIdForProvider(providerKey);
            if (activeLoginId) {
              const login = yield* Ref.get(activeLogins).pipe(
                Effect.map((logins) => logins.get(activeLoginId)),
              );
              if (login) {
                yield* Effect.promise(() => login.login.cancel()).pipe(
                  Effect.catchAll(() => Effect.void),
                );
              }
            }
            yield* authRepository.delete(providerKey);
          }),
      } satisfies ProviderAuthServiceApi;
    }),
  );
};
