import type {
  ThreadRecord,
  ThreadSummary,
  ThreadViewModel,
} from "../../../../packages/contracts/src/chat";
import type { DatabaseClient } from "./database";

export class ThreadRepository {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  create(thread: ThreadRecord): void {
    this.#database
      .prepare(
        `
          INSERT INTO threads (
            id,
            workspace_id,
            provider_key,
            provider_session_id,
            title,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        thread.id,
        thread.workspaceId,
        thread.providerKey,
        thread.providerSessionId,
        thread.title,
        thread.createdAt,
        thread.updatedAt,
      );
  }

  get(threadId: string): ThreadRecord | null {
    const row = this.#database
      .prepare(
        `
          SELECT id, workspace_id, provider_key, provider_session_id, title, created_at, updated_at
          FROM threads
          WHERE id = ?
        `,
      )
      .get(threadId) as
      | {
          id: string;
          workspace_id: string;
          provider_key: string;
          provider_session_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      providerKey: row.provider_key,
      providerSessionId: row.provider_session_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listByWorkspace(workspaceId: string): readonly ThreadSummary[] {
    const rows = this.#database
      .prepare(
        `
          SELECT snapshots.summary_json AS summary_json
          FROM thread_snapshots AS snapshots
          INNER JOIN threads ON threads.id = snapshots.thread_id
          WHERE threads.workspace_id = ?
          ORDER BY snapshots.updated_at DESC
        `,
      )
      .all(workspaceId) as { summary_json: string }[];

    return rows.map((row) => JSON.parse(row.summary_json) as ThreadSummary);
  }

  getSnapshot(threadId: string): ThreadViewModel | null {
    const row = this.#database
      .prepare("SELECT thread_json FROM thread_snapshots WHERE thread_id = ?")
      .get(threadId) as { thread_json: string } | undefined;

    return row ? (JSON.parse(row.thread_json) as ThreadViewModel) : null;
  }

  saveSnapshot(
    threadId: string,
    summary: ThreadSummary,
    thread: ThreadViewModel,
  ): void {
    this.#database
      .prepare(
        `
          INSERT INTO thread_snapshots (thread_id, summary_json, thread_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            summary_json = excluded.summary_json,
            thread_json = excluded.thread_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        threadId,
        JSON.stringify(summary),
        JSON.stringify(thread),
        thread.updatedAt,
      );

    this.#database
      .prepare("UPDATE threads SET updated_at = ? WHERE id = ?")
      .run(thread.updatedAt, threadId);
  }
}
