import type { ProviderSessionRecord } from "../../../../packages/contracts/src/provider";
import type { DatabaseClient } from "./database";

export class ProviderSessionRepository {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  create(record: ProviderSessionRecord): void {
    this.#database
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
  }

  get(sessionId: string): ProviderSessionRecord | null {
    const row = this.#database
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

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      providerKey: row.provider_key,
      workspaceId: row.workspace_id,
      status: row.status,
      providerSessionRef: row.provider_session_ref,
      providerThreadRef: row.provider_thread_ref,
      capabilities: JSON.parse(row.capabilities_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateStatus(
    sessionId: string,
    status: ProviderSessionRecord["status"],
    updatedAt: string,
  ): void {
    this.#database
      .prepare(
        "UPDATE provider_sessions SET status = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, updatedAt, sessionId);
  }
}
