import { Cause, Effect, Exit, Option } from "effect";

import {
  type BackendError,
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  ReplayError,
} from "../runtime/errors";

const toBackendError = (error: unknown): BackendError => {
  if (
    error instanceof NotFoundError ||
    error instanceof InvalidStateError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ProviderFailureError ||
    error instanceof PersistenceError ||
    error instanceof ReplayError
  ) {
    return error;
  }

  return new InvalidStateError({
    code: "backend_unexpected_error",
    detail: error instanceof Error ? error.message : String(error),
  });
};

export const fromSync = <A>(thunk: () => A): Effect.Effect<A, BackendError> =>
  Effect.try({
    try: thunk,
    catch: toBackendError,
  });

export const fromPromise = <A>(
  thunk: () => Promise<A>,
): Effect.Effect<A, BackendError> =>
  Effect.tryPromise({
    try: thunk,
    catch: toBackendError,
  });

export const runThreadEffect = <A>(
  effect: Effect.Effect<A, BackendError>,
): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) {
      throw failure.value;
    }

    throw new Error("Unhandled backend effect failure");
  });
