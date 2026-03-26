// Implements the local browser OAuth harness and callback flow for Codex login.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Server as HttpServer, createServer } from "node:http";

import { ProviderFailureError } from "../../core/errors";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const DEFAULT_CALLBACK_HOST = "localhost";
const DEFAULT_CALLBACK_PORT = 1455;

export interface CodexOAuthHarnessOptions {
  readonly issuer?: string;
  readonly clientId?: string;
  readonly callbackHost?: string;
  readonly callbackPort?: number;
  readonly loginTimeoutMs?: number;
}

export interface CodexOAuthLogin {
  readonly loginId: string;
  readonly authUrl: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly waitForCode: () => Promise<string>;
  readonly cancel: () => Promise<void>;
}

const toProviderFailure = (code: string, detail: string) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable: false,
  });

const base64UrlEncode = (buffer: Buffer): string => {
  return buffer.toString("base64url");
};

const buildCodeVerifier = (): string => {
  return base64UrlEncode(randomBytes(48));
};

const buildCodeChallenge = (verifier: string): string => {
  return createHash("sha256").update(verifier).digest("base64url");
};

const buildState = (): string => {
  return base64UrlEncode(randomBytes(32));
};

const successHtml = `
<!doctype html>
<html>
  <body>
    <h1>Magick Authorization Successful</h1>
    <p>You can close this window and return to Magick.</p>
  </body>
</html>`;

const redirectHtml = (target: string) => `
<!doctype html>
<html>
  <head>
    <meta http-equiv="refresh" content="0;url=${target}">
  </head>
  <body>
    <p>Redirecting...</p>
  </body>
</html>`;

const errorHtml = (message: string) => `
<!doctype html>
<html>
  <body>
    <h1>Magick Authorization Failed</h1>
    <p>${message}</p>
  </body>
</html>`;

export class CodexOAuthHarness {
  readonly #issuer: string;
  readonly #clientId: string;
  readonly #callbackHost: string;
  readonly #callbackPort: number;
  readonly #loginTimeoutMs: number;

  constructor(options: CodexOAuthHarnessOptions = {}) {
    this.#issuer = options.issuer ?? ISSUER;
    this.#clientId = options.clientId ?? CLIENT_ID;
    this.#callbackHost = options.callbackHost ?? DEFAULT_CALLBACK_HOST;
    this.#callbackPort = options.callbackPort ?? DEFAULT_CALLBACK_PORT;
    this.#loginTimeoutMs = options.loginTimeoutMs ?? 5 * 60 * 1000;
  }

  async startLogin(): Promise<CodexOAuthLogin> {
    try {
      const loginId = randomUUID();
      const codeVerifier = buildCodeVerifier();
      const codeChallenge = buildCodeChallenge(codeVerifier);
      const state = buildState();

      let completed = false;
      let server: HttpServer | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let finish:
        | ((result: {
            readonly code?: string;
            readonly error?: string;
          }) => void)
        | null = null;

      const callbackServer = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://${this.#callbackHost}`);

        if (url.pathname === "/auth/callback") {
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          const error = url.searchParams.get("error");
          const errorDescription = url.searchParams.get("error_description");

          if (error) {
            response.writeHead(302, {
              Location: `/error?message=${encodeURIComponent(errorDescription ?? error)}`,
              "Content-Type": "text/html",
            });
            response.end(
              redirectHtml(
                `/error?message=${encodeURIComponent(errorDescription ?? error)}`,
              ),
            );
            finish?.({ error: errorDescription ?? error });
            return;
          }

          if (!code) {
            response.writeHead(302, {
              Location: "/error?message=Missing%20authorization%20code.",
              "Content-Type": "text/html",
            });
            response.end(
              redirectHtml("/error?message=Missing%20authorization%20code."),
            );
            finish?.({ error: "Missing authorization code." });
            return;
          }

          if (returnedState !== state) {
            response.writeHead(302, {
              Location: "/error?message=Invalid%20OAuth%20state.",
              "Content-Type": "text/html",
            });
            response.end(
              redirectHtml("/error?message=Invalid%20OAuth%20state."),
            );
            finish?.({ error: "Invalid OAuth state." });
            return;
          }

          response.writeHead(302, {
            Location: "/success",
            "Content-Type": "text/html",
          });
          response.end(redirectHtml("/success"));
          finish?.({ code });
          return;
        }

        if (url.pathname === "/success") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(successHtml);
          return;
        }

        if (url.pathname === "/error") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(
            errorHtml(url.searchParams.get("message") ?? "Unknown error"),
          );
          return;
        }

        if (url.pathname === "/cancel") {
          response.writeHead(200, { "Content-Type": "text/plain" });
          response.end("Login cancelled");
          finish?.({ error: "Login cancelled" });
          return;
        }

        response.writeHead(404);
        response.end("Not found");
      });
      server = callbackServer;

      const completion = new Promise<string>((resolve, reject) => {
        finish = (result: { code?: string; error?: string }) => {
          if (completed) {
            return;
          }
          completed = true;
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          if (server) {
            void new Promise<void>((closeResolve) => {
              server?.close(() => closeResolve());
            });
          }

          if (result.error) {
            reject(new Error(result.error));
            return;
          }

          resolve(result.code ?? "");
        };

        timeoutHandle = setTimeout(() => {
          finish?.({ error: "OAuth login timed out." });
        }, this.#loginTimeoutMs);
      });

      await new Promise<void>((resolve, reject) => {
        callbackServer.listen(this.#callbackPort, this.#callbackHost, () =>
          resolve(),
        );
        callbackServer.once("error", reject);
      });

      const address = callbackServer.address();
      if (!address || typeof address === "string") {
        throw toProviderFailure(
          "oauth_server_start_failed",
          "OAuth callback server failed to bind a TCP port.",
        );
      }

      const redirectUri = `http://${this.#callbackHost}:${address.port}/auth/callback`;
      const authUrl = `${this.#issuer}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: this.#clientId,
        redirect_uri: redirectUri,
        scope: "openid profile email offline_access",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
      }).toString()}`;

      return {
        loginId,
        authUrl,
        redirectUri,
        codeVerifier,
        waitForCode: () => completion,
        cancel: async () => {
          if (completed) {
            return;
          }
          finish?.({ error: "Login cancelled" });
        },
      } satisfies CodexOAuthLogin;
    } catch (error) {
      throw error instanceof ProviderFailureError
        ? error
        : toProviderFailure(
            "oauth_server_start_failed",
            error instanceof Error ? error.message : String(error),
          );
    }
  }
}
