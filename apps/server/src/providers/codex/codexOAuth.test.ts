// Verifies the browser OAuth harness resolves callbacks and cancellation correctly.

import { request } from "node:http";

import { Effect } from "effect";

import { CodexOAuthHarness } from "./codexOAuth";

const fetchPath = async (urlString: string) => {
  const url = new URL(urlString);
  await new Promise<void>((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.end();
  });
};

describe("CodexOAuthHarness", () => {
  it("starts a browser login and resolves the callback code", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(harness.startLogin());

    const authUrl = new URL(login.authUrl);
    const redirectUri = authUrl.searchParams.get("redirect_uri");
    const state = authUrl.searchParams.get("state");

    expect(redirectUri).toBe(login.redirectUri);
    expect(state).toBeTruthy();

    void fetchPath(`${login.redirectUri}?code=auth_code&state=${state}`);

    await expect(login.waitForCode()).resolves.toBe("auth_code");
  });

  it("can cancel an in-flight browser login", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(harness.startLogin());

    await login.cancel();
    await expect(login.waitForCode()).rejects.toThrow("Login cancelled");
  });

  it("rejects callbacks with an invalid OAuth state", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(harness.startLogin());

    void fetchPath(`${login.redirectUri}?code=auth_code&state=wrong-state`);

    await expect(login.waitForCode()).rejects.toThrow("Invalid OAuth state");
  });

  it("rejects callbacks that omit the authorization code", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(harness.startLogin());
    const authUrl = new URL(login.authUrl);
    const state = authUrl.searchParams.get("state");

    void fetchPath(`${login.redirectUri}?state=${state}`);

    await expect(login.waitForCode()).rejects.toThrow(
      "Missing authorization code",
    );
  });

  it("times out when no callback arrives", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 10,
    });
    const login = await Effect.runPromise(harness.startLogin());

    await expect(login.waitForCode()).rejects.toThrow("OAuth login timed out");
  });

  it("surfaces provider-returned oauth errors from the callback", async () => {
    const harness = new CodexOAuthHarness({
      callbackPort: 0,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(harness.startLogin());
    const authUrl = new URL(login.authUrl);
    const state = authUrl.searchParams.get("state");

    void fetchPath(
      `${login.redirectUri}?error=access_denied&error_description=Denied&state=${state}`,
    );

    await expect(login.waitForCode()).rejects.toThrow("Denied");
  });

  it("fails to start when the callback port is already in use", async () => {
    const first = new CodexOAuthHarness({
      callbackPort: 14555,
      loginTimeoutMs: 1000,
    });
    const login = await Effect.runPromise(first.startLogin());
    const second = new CodexOAuthHarness({
      callbackPort: 14555,
      loginTimeoutMs: 1000,
    });

    await expect(Effect.runPromise(second.startLogin())).rejects.toBeTruthy();
    const completion = login.waitForCode().catch(() => undefined);
    await login.cancel();
    await completion;
  });
});
