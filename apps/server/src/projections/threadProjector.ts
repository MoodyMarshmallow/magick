// Reduces thread domain events into UI-ready thread and summary projections.

import type {
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
  TranscriptMessage,
} from "../../../../packages/contracts/src/chat";

type MutableThreadViewModel = {
  -readonly [K in keyof ThreadViewModel]: ThreadViewModel[K];
};

const upsertMessage = (
  messages: readonly TranscriptMessage[],
  nextMessage: TranscriptMessage,
): readonly TranscriptMessage[] => {
  const existingIndex = messages.findIndex(
    (message) => message.id === nextMessage.id,
  );

  if (existingIndex === -1) {
    return [...messages, nextMessage];
  }

  const nextMessages = [...messages];
  nextMessages[existingIndex] = nextMessage;
  return nextMessages;
};

const findAssistantMessageByTurn = (
  state: ThreadViewModel,
  turnId: string,
): TranscriptMessage | undefined => {
  return state.messages.find((message) => message.id === `${turnId}:assistant`);
};

const cloneThread = (thread: ThreadViewModel): MutableThreadViewModel => {
  return {
    threadId: thread.threadId,
    workspaceId: thread.workspaceId,
    providerKey: thread.providerKey,
    providerSessionId: thread.providerSessionId,
    title: thread.title,
    status: thread.status,
    messages: [...thread.messages],
    activeTurnId: thread.activeTurnId,
    latestSequence: thread.latestSequence,
    lastError: thread.lastError,
    lastUserMessageAt: thread.lastUserMessageAt,
    lastAssistantMessageAt: thread.lastAssistantMessageAt,
    updatedAt: thread.updatedAt,
  };
};

export const projectThreadEvents = (
  seed: ThreadViewModel | null,
  events: readonly DomainEvent[],
): ThreadViewModel => {
  if (!seed && events[0]?.type !== "thread.created") {
    throw new Error(
      "Thread projection requires a thread.created event as a seed.",
    );
  }

  let state: MutableThreadViewModel | null = seed ? cloneThread(seed) : null;

  for (const event of events) {
    if (!state) {
      if (event.type !== "thread.created") {
        throw new Error("Thread projection seed is missing.");
      }

      state = {
        threadId: event.threadId,
        workspaceId: event.payload.workspaceId,
        providerKey: event.payload.providerKey,
        providerSessionId: event.providerSessionId,
        title: event.payload.title,
        status: "idle",
        messages: [],
        activeTurnId: null,
        latestSequence: event.sequence,
        lastError: null,
        lastUserMessageAt: null,
        lastAssistantMessageAt: null,
        updatedAt: event.occurredAt,
      };
      continue;
    }

    switch (event.type) {
      case "thread.created":
        state.title = event.payload.title;
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        break;
      case "provider.session.started":
      case "provider.session.recovered":
        state.providerSessionId = event.providerSessionId;
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        break;
      case "provider.session.disconnected":
        state.status = state.activeTurnId ? "failed" : state.status;
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.reason;
        break;
      case "message.user.created":
        state.messages = [
          ...state.messages,
          {
            id: event.payload.messageId,
            role: "user",
            content: event.payload.content,
            status: "complete",
          },
        ];
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastUserMessageAt = event.occurredAt;
        state.lastError = null;
        break;
      case "turn.started":
        state.status = "running";
        state.activeTurnId = event.payload.turnId;
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastError = null;
        break;
      case "turn.delta": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.messages = upsertMessage(state.messages, {
          id: `${event.payload.turnId}:assistant`,
          role: "assistant",
          content: `${existing?.content ?? ""}${event.payload.delta}`,
          status: "streaming",
        });
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastAssistantMessageAt = event.occurredAt;
        break;
      }
      case "turn.completed": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.status = "idle";
        state.activeTurnId = null;
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
            status: "complete",
          });
        }
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastAssistantMessageAt = event.occurredAt;
        break;
      }
      case "turn.interrupted": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.status = "interrupted";
        state.activeTurnId = null;
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
            status: "interrupted",
          });
        }
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.reason;
        break;
      }
      case "turn.failed": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.status = "failed";
        state.activeTurnId = null;
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
            status: "failed",
          });
        }
        state.latestSequence = event.sequence;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.error;
        break;
      }
    }
  }

  if (!state) {
    throw new Error("Thread projection did not produce state.");
  }

  return state;
};

export const toThreadSummary = (thread: ThreadViewModel): ThreadSummary => {
  return {
    threadId: thread.threadId,
    workspaceId: thread.workspaceId,
    providerKey: thread.providerKey,
    title: thread.title,
    status: thread.status,
    latestSequence: thread.latestSequence,
    updatedAt: thread.updatedAt,
  };
};
