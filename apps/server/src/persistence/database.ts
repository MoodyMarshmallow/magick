// Initializes the SQLite schema used by backend persistence services.

import Database from "better-sqlite3";

export type DatabaseClient = InstanceType<typeof Database>;

export const createDatabase = (filename = ":memory:"): DatabaseClient => {
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_sessions (
      id TEXT PRIMARY KEY,
      provider_key TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_session_ref TEXT,
      provider_thread_ref TEXT,
      capabilities_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_auth_records (
      provider_key TEXT PRIMARY KEY,
      auth_mode TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      account_id TEXT,
      email TEXT,
      plan_type TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      kind TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      provider_key TEXT,
      payload_json TEXT NOT NULL,
      status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(parent_id) REFERENCES context_nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS context_nodes_parent_sequence_idx
      ON context_nodes(parent_id, sequence);

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      provider_key TEXT NOT NULL,
      title TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(target_node_id) REFERENCES context_nodes(id) ON DELETE RESTRICT
    );
  `);
  return database;
};
