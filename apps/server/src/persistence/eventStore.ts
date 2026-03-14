import { Context, Effect, Layer } from "effect";

import type { DomainEvent } from "../../../../packages/contracts/src/chat";
import { PersistenceError } from "../effect/errors";
import type { DatabaseClient } from "./database";

type UnsequencedEvent = Omit<DomainEvent, "sequence">;

type EventRow = {
  id: string;
  thread_id: string;
  provider_session_id: string;
  sequence: number;
  type: DomainEvent["type"];
  payload_json: string;
  occurred_at: string;
};

export interface EventStoreService {
  readonly append: (
    threadId: string,
    events: readonly UnsequencedEvent[],
  ) => Effect.Effect<readonly DomainEvent[], PersistenceError>;
  readonly listThreadEvents: (
    threadId: string,
    afterSequence?: number,
  ) => Effect.Effect<readonly DomainEvent[], PersistenceError>;
}

export const EventStore =
  Context.GenericTag<EventStoreService>("@magick/EventStore");

const parseDomainEventRow = (row: EventRow): DomainEvent => {
  return {
    eventId: row.id,
    threadId: row.thread_id,
    providerSessionId: row.provider_session_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    type: row.type,
    payload: JSON.parse(row.payload_json),
  } as DomainEvent;
};

export const makeEventStoreLayer = (database: DatabaseClient) => {
  const appendMany = database.transaction(
    (threadId: string, pendingEvents: readonly UnsequencedEvent[]) => {
      const current = database
        .prepare(
          `
            SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
            FROM thread_events
            WHERE thread_id = ?
          `,
        )
        .get(threadId) as { next_sequence: number } | undefined;

      let nextSequence = current?.next_sequence ?? 1;
      const insert = database.prepare(`
        INSERT INTO thread_events (
          id,
          thread_id,
          provider_session_id,
          sequence,
          type,
          payload_json,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      return pendingEvents.map((event) => {
        const sequencedEvent: DomainEvent = {
          ...event,
          sequence: nextSequence,
        } as DomainEvent;

        insert.run(
          sequencedEvent.eventId,
          threadId,
          sequencedEvent.providerSessionId,
          sequencedEvent.sequence,
          sequencedEvent.type,
          JSON.stringify(sequencedEvent.payload),
          sequencedEvent.occurredAt,
        );

        nextSequence += 1;
        return sequencedEvent;
      });
    },
  );

  return Layer.succeed(EventStore, {
    append: (threadId, events) =>
      Effect.try({
        try: () => {
          if (events.length === 0) {
            return [];
          }

          return appendMany(threadId, events);
        },
        catch: (error) =>
          new PersistenceError({
            operation: "event_store.append",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
    listThreadEvents: (threadId, afterSequence = 0) =>
      Effect.try({
        try: () => {
          const rows = database
            .prepare(
              `
                SELECT id, thread_id, provider_session_id, sequence, type, payload_json, occurred_at
                FROM thread_events
                WHERE thread_id = ? AND sequence > ?
                ORDER BY sequence ASC
              `,
            )
            .all(threadId, afterSequence) as EventRow[];

          return rows.map(parseDomainEventRow);
        },
        catch: (error) =>
          new PersistenceError({
            operation: "event_store.listThreadEvents",
            detail: error instanceof Error ? error.message : String(error),
          }),
      }),
  });
};
