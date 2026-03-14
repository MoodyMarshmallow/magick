import {
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  ReplayError,
  backendErrorCode,
  backendErrorMessage,
} from "./errors";

describe("backendError helpers", () => {
  it("maps error variants to stable codes and messages", () => {
    expect(
      backendErrorCode(new NotFoundError({ entity: "thread", id: "t1" })),
    ).toBe("not_found");
    expect(
      backendErrorMessage(new NotFoundError({ entity: "thread", id: "t1" })),
    ).toContain("thread 't1'");

    expect(
      backendErrorCode(
        new InvalidStateError({ code: "bad_state", detail: "bad" }),
      ),
    ).toBe("bad_state");
    expect(
      backendErrorCode(new ProviderUnavailableError({ providerKey: "codex" })),
    ).toBe("provider_unavailable");
    expect(
      backendErrorCode(
        new ProviderFailureError({
          providerKey: "codex",
          code: "provider_failed",
          detail: "boom",
          retryable: true,
        }),
      ),
    ).toBe("provider_failed");
    expect(
      backendErrorCode(
        new PersistenceError({ operation: "save", detail: "boom" }),
      ),
    ).toBe("persistence_failure");
    expect(
      backendErrorCode(new ReplayError({ threadId: "t1", detail: "boom" })),
    ).toBe("replay_failure");
  });
});
