// Implements direct OAuth code exchange and token refresh for Codex browser auth.

import { ProviderFailureError } from "../../core/errors";
import {
  extractAccountIdFromClaims,
  extractEmailFromClaims,
  parseJwtClaims,
} from "./codexJwt";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";

interface CodexTokenResponse {
  readonly id_token?: string;
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in?: number;
}

interface CodexAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string | null;
  readonly email: string | null;
}

export interface CodexAuthClientOptions {
  readonly fetch?: typeof fetch;
  readonly clientId?: string;
  readonly issuer?: string;
}

const toProviderFailure = (code: string, detail: string, retryable = true) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable,
  });

const toTokenSet = (response: CodexTokenResponse): CodexAuthTokenSet => {
  const claims = response.id_token
    ? parseJwtClaims(response.id_token)
    : parseJwtClaims(response.access_token);

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    accountId: claims ? (extractAccountIdFromClaims(claims) ?? null) : null,
    email: claims ? (extractEmailFromClaims(claims) ?? null) : null,
  };
};

export class CodexAuthClient {
  readonly #fetch: typeof fetch;
  readonly #clientId: string;
  readonly #issuer: string;

  constructor(options: CodexAuthClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#clientId = options.clientId ?? CLIENT_ID;
    this.#issuer = options.issuer ?? ISSUER;
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<CodexAuthTokenSet> {
    try {
      const response = await this.#fetch(`${this.#issuer}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: this.#clientId,
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (!response.ok) {
        throw toProviderFailure(
          "oauth_exchange_failed",
          `OAuth token exchange failed with status ${response.status}.`,
          false,
        );
      }

      return toTokenSet((await response.json()) as CodexTokenResponse);
    } catch (error) {
      throw error instanceof ProviderFailureError
        ? error
        : toProviderFailure(
            "oauth_exchange_failed",
            error instanceof Error ? error.message : String(error),
            false,
          );
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<CodexAuthTokenSet> {
    try {
      const response = await this.#fetch(`${this.#issuer}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.#clientId,
        }).toString(),
      });

      if (!response.ok) {
        throw toProviderFailure(
          "oauth_refresh_failed",
          `OAuth token refresh failed with status ${response.status}.`,
          false,
        );
      }

      return toTokenSet((await response.json()) as CodexTokenResponse);
    } catch (error) {
      throw error instanceof ProviderFailureError
        ? error
        : toProviderFailure(
            "oauth_refresh_failed",
            error instanceof Error ? error.message : String(error),
            false,
          );
    }
  }
}
