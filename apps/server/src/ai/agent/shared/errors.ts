// Defines the backend error types and helpers used for consistent transport-safe failure handling.

import { Data } from "effect";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly id: string;
}> {}

export class InvalidStateError extends Data.TaggedError("InvalidStateError")<{
  readonly code: string;
  readonly detail: string;
}> {}

export class ProviderUnavailableError extends Data.TaggedError(
  "ProviderUnavailableError",
)<{
  readonly providerKey: string;
}> {}

export class ProviderFailureError extends Data.TaggedError(
  "ProviderFailureError",
)<{
  readonly providerKey: string;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;
}> {}

export class PersistenceError extends Data.TaggedError("PersistenceError")<{
  readonly operation: string;
  readonly detail: string;
}> {}

export type BackendError =
  | NotFoundError
  | InvalidStateError
  | ProviderUnavailableError
  | ProviderFailureError
  | PersistenceError;

export const backendErrorMessage = (error: BackendError): string => {
  switch (error._tag) {
    case "NotFoundError":
      return `${error.entity} '${error.id}' was not found.`;
    case "InvalidStateError":
      return error.detail;
    case "ProviderUnavailableError":
      return `Provider '${error.providerKey}' is not registered.`;
    case "ProviderFailureError":
      return error.detail;
    case "PersistenceError":
      return `Persistence operation '${error.operation}' failed: ${error.detail}`;
  }
};

export const backendErrorCode = (error: BackendError): string => {
  switch (error._tag) {
    case "NotFoundError":
      return "not_found";
    case "InvalidStateError":
      return error.code;
    case "ProviderUnavailableError":
      return "provider_unavailable";
    case "ProviderFailureError":
      return error.code;
    case "PersistenceError":
      return "persistence_failure";
  }
};
