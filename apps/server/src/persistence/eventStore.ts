import type { DomainEvent } from "../../../../packages/contracts/src/chat";
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

export class EventStore {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  append(
    threadId: string,
    events: readonly UnsequencedEvent[],
  ): readonly DomainEvent[] {
    if (events.length === 0) {
      return [];
    }

    const appendMany = this.#database.transaction(
      (pendingEvents: readonly UnsequencedEvent[]) => {
        const current = this.#database
          .prepare(
            `
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM thread_events
              WHERE thread_id = ?
            `,
          )
          .get(threadId) as { next_sequence: number } | undefined;

        let nextSequence = current?.next_sequence ?? 1;
        const insert = this.#database.prepare(`
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

    return appendMany(events);
  }

  listThreadEvents(
    threadId: string,
    afterSequence = 0,
  ): readonly DomainEvent[] {
    const rows = this.#database
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
  }
}
