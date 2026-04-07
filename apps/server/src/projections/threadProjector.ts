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
      case "turn.delta": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.messages = upsertMessage(state.messages, {
          id: `${event.payload.turnId}:assistant`,
          role: "assistant",
          content: `${existing?.content ?? ""}${event.payload.delta}`,
          createdAt: existing?.createdAt ?? event.occurredAt,
          status: "streaming",
        });
        state.latestSequence = event.sequence;
        state.latestActivityAt = event.occurredAt;
        state.updatedAt = event.occurredAt;
        state.lastAssistantMessageAt = event.occurredAt;
        break;
      }
      case "turn.completed": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.runtimeState = "idle";
        state.activeTurnId = null;
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
      case "turn.interrupted": {
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.runtimeState = "interrupted";
        state.activeTurnId = null;
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
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
        const existing = findAssistantMessageByTurn(
          state,
          event.payload.turnId,
        );
        state.runtimeState = "failed";
        state.activeTurnId = null;
        if (existing) {
          state.messages = upsertMessage(state.messages, {
            ...existing,
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
