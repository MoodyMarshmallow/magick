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

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE(thread_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS thread_snapshots (
      thread_id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL,
      thread_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connection_checkpoints (
      connection_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      latest_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, thread_id)
    );
  `);

  return database;
};
