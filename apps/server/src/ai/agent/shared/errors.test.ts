// Verifies backend error helpers map errors to stable codes and messages.

import {
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  backendErrorCode,
  backendErrorMessage,
} from "./errors";

describe("backendError helpers", () => {
  it("maps error variants to stable codes and messages", () => {
    expect(
      backendErrorCode(new NotFoundError({ entity: "bookmark", id: "b1" })),
    ).toBe("not_found");
    expect(
      backendErrorMessage(new NotFoundError({ entity: "bookmark", id: "b1" })),
    ).toContain("bookmark 'b1'");

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
  });
});
