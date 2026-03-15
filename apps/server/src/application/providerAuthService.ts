import { Context, Effect, Layer, Ref } from "effect";

import type {
  ProviderAuthLoginStartResult,
  ProviderAuthState,
  ProviderKey,
} from "../../../../packages/contracts/src/provider";
import {
  type BackendError,
  InvalidStateError,
  ProviderUnavailableError,
} from "../effect/errors";
import {
  type CodexAppServerClient,
  type CodexClientFactoryOptions,
  createCodexAppServerClient,
} from "../providers/codex/codexAppServerClient";

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

export interface ProviderAuthServiceOptions extends CodexClientFactoryOptions {}

export const ProviderAuthServiceLive = (
  options: ProviderAuthServiceOptions = {},
) =>
  Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const activeLogins = yield* Ref.make(
        new Map<
          string,
          {
            readonly providerKey: ProviderKey;
            readonly client: CodexAppServerClient;
            readonly dispose: () => Effect.Effect<void>;
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

      const assertCodexProvider = (providerKey: ProviderKey) => {
        if (providerKey !== "codex") {
          return Effect.fail(
            new ProviderUnavailableError({ providerKey: String(providerKey) }),
          );
        }

        return Effect.void;
      };

      const createClient = () => createCodexAppServerClient(options);

      return {
        read: (providerKey: ProviderKey, refreshToken = false) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const client = yield* createClient();
            const account = yield* client
              .readAccount(refreshToken)
              .pipe(Effect.ensuring(client.dispose()));
            const activeLoginId = yield* activeLoginIdForProvider(providerKey);

            return {
              providerKey,
              requiresOpenaiAuth: account.requiresOpenaiAuth,
              account: account.account,
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

            const client = yield* createClient();
            const login = yield* client.startChatGptLogin();

            yield* Ref.update(activeLogins, (logins) => {
              const next = new Map(logins);
              next.set(login.loginId, {
                providerKey,
                client,
                dispose: () => client.dispose(),
              });
              return next;
            });

            void Effect.runFork(
              client.waitForLoginCompletion(login.loginId).pipe(
                Effect.catchAll(() => Effect.void),
                Effect.flatMap(() => client.dispose()),
                Effect.ensuring(
                  Ref.update(activeLogins, (logins) => {
                    const next = new Map(logins);
                    next.delete(login.loginId);
                    return next;
                  }),
                ),
              ),
            );

            return login;
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

            yield* login.client.cancelLogin(loginId);
            yield* login.dispose();
            yield* Ref.update(activeLogins, (logins) => {
              const next = new Map(logins);
              next.delete(loginId);
              return next;
            });
          }),
        logout: (providerKey: ProviderKey) =>
          Effect.gen(function* () {
            yield* assertCodexProvider(providerKey);
            const client = yield* createClient();
            yield* client.logout().pipe(Effect.ensuring(client.dispose()));
          }),
      } satisfies ProviderAuthServiceApi;
    }),
  );
