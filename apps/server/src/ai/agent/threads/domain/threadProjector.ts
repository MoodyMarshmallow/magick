// Reduces thread domain events into UI-ready thread and summary projections.

import type {
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
  ToolActivityView,
  TranscriptMessage,
} from "@magick/contracts/chat";

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

const assistantMessageIdPrefix = (turnId: string) => `${turnId}:assistant:`;

const isAssistantMessageForTurn = (
  messageId: string,
  turnId: string,
): boolean => {
  return messageId.startsWith(assistantMessageIdPrefix(turnId));
};

const findLatestAssistantMessageByTurn = (
  state: ThreadViewModel,
  turnId: string,
): TranscriptMessage | undefined => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message && isAssistantMessageForTurn(message.id, turnId)) {
      return message;
    }
  }

  return undefined;
};

const findStreamingAssistantMessagesByTurn = (
  state: ThreadViewModel,
  turnId: string,
): readonly TranscriptMessage[] => {
  return state.messages.filter(
    (message) =>
      isAssistantMessageForTurn(message.id, turnId) &&
      message.status === "streaming",
  );
};

const cloneThread = (thread: ThreadViewModel): MutableThreadViewModel => {
  return {
    threadId: thread.threadId,
    workspaceId: thread.workspaceId,
    providerKey: thread.providerKey,
    providerSessionId: thread.providerSessionId,
    title: thread.title,
    resolutionState: thread.resolutionState,
    runtimeState: thread.runtimeState,
    messages: [...thread.messages],
    toolActivities: [...thread.toolActivities],
    pendingToolApproval: thread.pendingToolApproval,
    activeTurnId: thread.activeTurnId,
    latestSequence: thread.latestSequence,
    lastError: thread.lastError,
    lastUserMessageAt: thread.lastUserMessageAt,
    lastAssistantMessageAt: thread.lastAssistantMessageAt,
    latestActivityAt: thread.latestActivityAt,
    updatedAt: thread.updatedAt,
  };
};

const upsertToolActivity = (
  toolActivities: readonly ToolActivityView[],
  nextActivity: ToolActivityView,
): readonly ToolActivityView[] => {
  const existingIndex = toolActivities.findIndex(
    (toolActivity) => toolActivity.toolCallId === nextActivity.toolCallId,
  );
  if (existingIndex === -1) {
    return [...toolActivities, nextActivity];
  }

  const nextToolActivities = [...toolActivities];
  nextToolActivities[existingIndex] = nextActivity;
  return nextToolActivities;
};

const findToolActivity = (
  state: ThreadViewModel,
  toolCallId: string,
): ToolActivityView | undefined => {
  return state.toolActivities.find(
    (toolActivity) => toolActivity.toolCallId === toolCallId,
  );
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
        resolutionState: "open",
        runtimeState: "idle",
        messages: [],
        toolActivities: [],
        pendingToolApproval: null,
        activeTurnId: null,
        latestSequence: event.sequence,
        lastError: null,
        lastUserMessageAt: null,
        lastAssistantMessageAt: null,
        latestActivityAt: event.occurredAt,
        updatedAt: event.occurredAt,
      };
      continue;
    }

    switch (event.type) {
      case "thread.created":
      case "thread.renamed":
        state.title = event.payload.title;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      case "thread.resolved":
        state.resolutionState = "resolved";
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      case "thread.reopened":
        state.resolutionState = "open";
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      case "provider.session.started":
      case "provider.session.recovered":
        state.providerSessionId = event.providerSessionId;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      case "provider.session.disconnected":
        state.runtimeState = state.activeTurnId ? "failed" : state.runtimeState;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.reason;
        break;
      case "message.user.created":
        state.messages = [
          ...state.messages,
          {
            id: event.payload.messageId,
            role: "user",
            channel: null,
            content: event.payload.content,
            createdAt: event.occurredAt,
            status: "complete",
          },
        ];
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastUserMessageAt = event.occurredAt;
        state.lastError = null;
        break;
      case "turn.started":
        state.runtimeState = "running";
        state.pendingToolApproval = null;
        state.activeTurnId = event.payload.turnId;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastError = null;
        break;
      case "message.assistant.delta": {
        const existing = state.messages.find(
          (message) => message.id === event.payload.messageId,
        );

        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
            content: `${existing.content}${event.payload.delta}`,
          });
        } else {
          state.messages = [
            ...state.messages,
            {
              id: event.payload.messageId,
              role: "assistant",
              channel: event.payload.channel,
              content: event.payload.delta,
              createdAt: event.occurredAt,
              status: "streaming",
            },
          ];
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastAssistantMessageAt = event.occurredAt;
        break;
      }
      case "message.assistant.completed": {
        const existing = state.messages.find(
          (message) => message.id === event.payload.messageId,
        );
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
            status: "complete",
          });
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastAssistantMessageAt = event.occurredAt;
        break;
      }
      case "turn.completed": {
        state.runtimeState = "idle";
        state.activeTurnId = null;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      }
      case "turn.interrupted": {
        const streamingMessages = findStreamingAssistantMessagesByTurn(
          state,
          event.payload.turnId,
        );
        state.runtimeState = "interrupted";
        state.activeTurnId = null;
        for (const message of streamingMessages) {
          state.messages = upsertMessage(state.messages, {
            ...message,
            status: "interrupted",
          });
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.reason;
        break;
      }
      case "turn.failed": {
        const streamingMessages = findStreamingAssistantMessagesByTurn(
          state,
          event.payload.turnId,
        );
        state.runtimeState = "failed";
        state.activeTurnId = null;
        for (const message of streamingMessages) {
          state.messages = upsertMessage(state.messages, {
            ...message,
            status: "failed",
          });
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.error;
        break;
      }
      case "tool.requested": {
        const streamingMessages = findStreamingAssistantMessagesByTurn(
          state,
          event.payload.turnId,
        );
        for (const message of streamingMessages) {
          state.messages = upsertMessage(state.messages, {
            ...message,
            status: "complete",
          });
        }
        state.toolActivities = upsertToolActivity(state.toolActivities, {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          title: event.payload.title,
          status: "requested",
          argsPreview: event.payload.argsPreview,
          resultPreview: null,
          path: event.payload.path,
          url: event.payload.url,
          diff: null,
          error: null,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        });
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      }
      case "tool.started": {
        const existing = findToolActivity(state, event.payload.toolCallId);
        if (existing) {
          state.toolActivities = upsertToolActivity(state.toolActivities, {
            ...existing,
            status: "running",
            updatedAt: event.occurredAt,
          });
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      }
      case "tool.completed": {
        const existing = findToolActivity(state, event.payload.toolCallId);
        if (existing) {
          state.toolActivities = upsertToolActivity(state.toolActivities, {
            ...existing,
            status: "completed",
            resultPreview: event.payload.resultPreview,
            path: event.payload.path ?? existing.path,
            url: event.payload.url ?? existing.url,
            diff: event.payload.diff,
            updatedAt: event.occurredAt,
          });
        }
        state.runtimeState = "running";
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      }
      case "tool.failed": {
        const existing = findToolActivity(state, event.payload.toolCallId);
        if (existing) {
          state.toolActivities = upsertToolActivity(state.toolActivities, {
            ...existing,
            status: "failed",
            error: event.payload.error,
            updatedAt: event.occurredAt,
          });
        }
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastError = event.payload.error;
        break;
      }
      case "tool.approval.requested": {
        const existing = findToolActivity(state, event.payload.toolCallId);
        if (existing) {
          state.toolActivities = upsertToolActivity(state.toolActivities, {
            ...existing,
            status: "awaiting_approval",
            updatedAt: event.occurredAt,
          });
        }
        state.runtimeState = "awaiting_approval";
        state.pendingToolApproval = {
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          path: event.payload.path,
          reason: event.payload.reason,
          requestedAt: event.occurredAt,
        };
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        break;
      }
      case "tool.approval.resolved": {
        const existing = findToolActivity(state, event.payload.toolCallId);
        if (existing) {
          state.toolActivities = upsertToolActivity(state.toolActivities, {
            ...existing,
            status:
              event.payload.decision === "approved" ? "running" : "failed",
            error:
              event.payload.decision === "approved"
                ? existing.error
                : "Tool execution was rejected.",
            updatedAt: event.occurredAt,
          });
        }
        state.runtimeState =
          event.payload.decision === "approved" ? "running" : "failed";
        state.pendingToolApproval = null;
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        if (event.payload.decision === "rejected") {
          state.lastError = "Tool execution was rejected.";
        }
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
    resolutionState: thread.resolutionState,
    runtimeState: thread.runtimeState,
    latestSequence: thread.latestSequence,
    latestActivityAt: thread.latestActivityAt,
    updatedAt: thread.updatedAt,
  };
};
