// Verifies the SQLite bootstrap creates the expected tables.

import { createDatabase } from "./database";

describe("createDatabase", () => {
  it("creates the expected backend tables", () => {
    const database = createDatabase();
    const tables = database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
          ORDER BY name ASC
        `,
      )
      .all() as { name: string }[];

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "connection_checkpoints",
        "provider_auth_records",
        "provider_sessions",
        "thread_events",
        "thread_snapshots",
        "threads",
        "workspaces",
      ]),
    );
  });
});
