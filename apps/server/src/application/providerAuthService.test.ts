import { Cause, Effect, Exit, Option } from "effect";

import {
  ProviderAuthService,
  ProviderAuthServiceLive,
} from "./providerAuthService";

describe("ProviderAuthService", () => {
  it("fails for non-codex providers", async () => {
    const service = await Effect.runPromise(
      ProviderAuthService.pipe(Effect.provide(ProviderAuthServiceLive())),
    );

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
});
