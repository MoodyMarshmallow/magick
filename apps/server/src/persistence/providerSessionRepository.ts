import { Context, Effect, Layer } from "effect";

import type { ProviderSessionRecord } from "../../../../packages/contracts/src/provider";
import { PersistenceError } from "../effect/errors";
import type { DatabaseClient } from "./database";

export interface ProviderSessionRepositoryService {
  readonly create: (
    record: ProviderSessionRecord,
  ) => Effect.Effect<void, PersistenceError>;
  readonly get: (
    sessionId: string,
  ) => Effect.Effect<ProviderSessionRecord | null, PersistenceError>;
  readonly updateStatus: (
    sessionId: string,
    status: ProviderSessionRecord["status"],
    updatedAt: string,
  ) => Effect.Effect<void, PersistenceError>;
  readonly updateRefs: (
    sessionId: string,
    refs: {
      readonly providerSessionRef: string | null;
      readonly providerThreadRef: string | null;
      readonly updatedAt: string;
    },
  ) => Effect.Effect<void, PersistenceError>;
}

export const ProviderSessionRepository =
  Context.GenericTag<ProviderSessionRepositoryService>(
    "@magick/ProviderSessionRepository",
  );

export const makeProviderSessionRepositoryLayer = (database: DatabaseClient) =>
  Layer.succeed(ProviderSessionRepository, {
    create: (record) =>
      Effect.try({
        try: () => {
          database
            .prepare(
              `
                INSERT INTO provider_sessions (
                  id,
                  provider_key,
                  workspace_id,
                  status,
                  provider_session_ref,
                  provider_thread_ref,
                  capabilities_json,
                  created_at,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
            )
            .run(
              record.id,
              record.providerKey,
              record.workspaceId,
              record.status,
              record.providerSessionRef,
              record.providerThreadRef,
              JSON.stringify(record.capabilities),
              record.createdAt,
              record.updatedAt,
            );
        },
        catch: (error) =>
          new PersistenceError({
            operation: "provider_session_repository.create",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
    get: (sessionId) =>
      Effect.try({
        try: () => {
          const row = database
            .prepare(
              `
                SELECT id, provider_key, workspace_id, status, provider_session_ref, provider_thread_ref,
                  capabilities_json, created_at, updated_at
                FROM provider_sessions
                WHERE id = ?
              `,
            )
            .get(sessionId) as
            | {
                id: string;
                provider_key: string;
                workspace_id: string;
                status: "active" | "disconnected" | "disposed";
                provider_session_ref: string | null;
                provider_thread_ref: string | null;
                capabilities_json: string;
                created_at: string;
                updated_at: string;
              }
            | undefined;

          return row
            ? {
                id: row.id,
                providerKey: row.provider_key,
                workspaceId: row.workspace_id,
                status: row.status,
                providerSessionRef: row.provider_session_ref,
                providerThreadRef: row.provider_thread_ref,
                capabilities: JSON.parse(row.capabilities_json),
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              }
            : null;
        },
        catch: (error) =>
          new PersistenceError({
            operation: "provider_session_repository.get",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
    updateStatus: (sessionId, status, updatedAt) =>
      Effect.try({
        try: () => {
          database
            .prepare(
              "UPDATE provider_sessions SET status = ?, updated_at = ? WHERE id = ?",
            )
            .run(status, updatedAt, sessionId);
        },
        catch: (error) =>
          new PersistenceError({
            operation: "provider_session_repository.updateStatus",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
    updateRefs: (sessionId, refs) =>
      Effect.try({
        try: () => {
          database
            .prepare(
              `
                UPDATE provider_sessions
                SET provider_session_ref = ?, provider_thread_ref = ?, updated_at = ?
                WHERE id = ?
              `,
            )
            .run(
              refs.providerSessionRef,
              refs.providerThreadRef,
              refs.updatedAt,
              sessionId,
            );
        },
        catch: (error) =>
          new PersistenceError({
            operation: "provider_session_repository.updateRefs",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
  });
