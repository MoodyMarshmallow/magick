// Verifies Codex OAuth code exchange and refresh behavior.

import { Cause, Effect, Exit, Option } from "effect";

import { CodexAuthClient } from "./codexAuthClient";

describe("CodexAuthClient", () => {
  it("exchanges auth codes and refreshes tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access_1",
            refresh_token: "refresh_1",
            expires_in: 100,
            id_token: [
              Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
                "base64url",
              ),
              Buffer.from(
                JSON.stringify({
                  chatgpt_account_id: "acct_1",
                  email: "user@example.com",
                }),
              ).toString("base64url"),
              "sig",
            ].join("."),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access_2",
            refresh_token: "refresh_2",
            expires_in: 100,
            id_token: [
              Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
                "base64url",
              ),
              Buffer.from(
                JSON.stringify({
                  chatgpt_account_id: "acct_2",
                  email: "user2@example.com",
                }),
              ).toString("base64url"),
              "sig",
            ].join("."),
          }),
          { status: 200 },
        ),
      );

    const client = new CodexAuthClient({ fetch: fetchMock as never });

    const exchanged = await Effect.runPromise(
      client.exchangeAuthorizationCode(
        "code",
        "http://localhost/callback",
        "verifier",
      ),
    );
    expect(exchanged.accountId).toBe("acct_1");

    const refreshed = await Effect.runPromise(
      client.refreshAccessToken("refresh_1"),
    );
    expect(refreshed.accountId).toBe("acct_2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails when token exchange is rejected by the issuer", async () => {
    const client = new CodexAuthClient({
      fetch: vi
        .fn()
        .mockResolvedValue(new Response("nope", { status: 400 })) as never,
    });

    const exit = await Effect.runPromiseExit(
      client.exchangeAuthorizationCode(
        "code",
        "http://localhost/callback",
        "verifier",
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "oauth_exchange_failed",
      });
    }
  });

  it("fails when refresh is rejected by the issuer", async () => {
    const client = new CodexAuthClient({
      fetch: vi
        .fn()
        .mockResolvedValue(new Response("nope", { status: 401 })) as never,
    });

    const exit = await Effect.runPromiseExit(
      client.refreshAccessToken("refresh"),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "oauth_refresh_failed",
      });
    }
  });
});
