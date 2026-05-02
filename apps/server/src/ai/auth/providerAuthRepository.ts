// Stores provider auth credentials and account metadata for direct provider integrations.

import type {
  ProviderAuthRecord,
  ProviderKey,
} from "@magick/contracts/provider";
import type { DatabaseClient } from "../../persistence/database";
import { PersistenceError } from "../agent/shared/errors";

export class ProviderAuthRepositoryClient {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  upsert(record: ProviderAuthRecord): void {
    try {
      this.#database
        .prepare(
          `
            INSERT INTO provider_auth_records (
              provider_key,
              auth_mode,
              access_token,
              refresh_token,
              expires_at,
              account_id,
              email,
              plan_type,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_key) DO UPDATE SET
              auth_mode = excluded.auth_mode,
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              expires_at = excluded.expires_at,
              account_id = excluded.account_id,
              email = excluded.email,
              plan_type = excluded.plan_type,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          record.providerKey,
          record.authMode,
          record.accessToken,
          record.refreshToken,
          record.expiresAt,
          record.accountId,
          record.email,
          record.planType,
          record.createdAt,
          record.updatedAt,
        );
    } catch (error) {
      throw new PersistenceError({
        operation: "provider_auth_repository.upsert",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  get(providerKey: ProviderKey): ProviderAuthRecord | null {
    try {
      const row = this.#database
        .prepare(
          `
            SELECT provider_key, auth_mode, access_token, refresh_token, expires_at,
              account_id, email, plan_type, created_at, updated_at
            FROM provider_auth_records
            WHERE provider_key = ?
          `,
        )
        .get(providerKey) as
        | {
            provider_key: string;
            auth_mode: "chatgpt";
            access_token: string;
            refresh_token: string;
            expires_at: number;
            account_id: string | null;
            email: string | null;
            plan_type: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      return row
        ? {
            providerKey: row.provider_key,
            authMode: row.auth_mode,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiresAt: row.expires_at,
            accountId: row.account_id,
            email: row.email,
            planType: row.plan_type,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }
        : null;
    } catch (error) {
      throw new PersistenceError({
        operation: "provider_auth_repository.get",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  delete(providerKey: ProviderKey): void {
    try {
      this.#database
        .prepare("DELETE FROM provider_auth_records WHERE provider_key = ?")
        .run(providerKey);
    } catch (error) {
      throw new PersistenceError({
        operation: "provider_auth_repository.delete",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
