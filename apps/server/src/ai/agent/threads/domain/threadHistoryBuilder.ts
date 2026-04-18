import type { ThreadViewModel } from "@magick/contracts/chat";

import type {
  ConversationContextMessage,
  ConversationHistoryItem,
} from "../../providers/providerTypes";
import type { EventStore } from "../persistence/eventStore";

type MutableAssistantHistoryMessage = {
  type: "message";
  role: "assistant";
  channel: "commentary" | "final";
  content: string;
  reason?: "tool_calls" | "stop" | "incomplete";
};

export class ThreadHistoryBuilder {
  readonly #eventStore: EventStore;

  constructor(args: { eventStore: EventStore }) {
    this.#eventStore = args.eventStore;
  }

  readonly buildContextMessages = (
    thread: ThreadViewModel,
  ): readonly ConversationContextMessage[] => {
    return thread.messages.map((message) => ({
      role: message.role,
      channel: message.channel,
      content: message.content,
      reason: message.reason ?? null,
    }));
  };

  readonly #parseToolInput = (
    value: string | null,
    fallback: unknown,
  ): unknown => {
    if (fallback !== undefined) {
      return fallback;
    }
    if (!value) {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return { rawInput: value };
    }
  };

  readonly buildConversationHistory = (
    threadId: string,
  ): readonly ConversationHistoryItem[] => {
    const events = this.#eventStore.listThreadEvents(threadId);
    const history: ConversationHistoryItem[] = [];
    const assistantMessages = new Map<string, MutableAssistantHistoryMessage>();

    for (const event of events) {
      switch (event.type) {
        case "message.user.created":
          history.push({
            type: "message",
            role: "user",
            channel: null,
            content: event.payload.content,
          });
          break;
        case "message.assistant.delta": {
          const assistantMessage = assistantMessages.get(
            event.payload.messageId,
          );
          if (assistantMessage) {
            assistantMessage.content += event.payload.delta;
            break;
          }

          const nextMessage: MutableAssistantHistoryMessage = {
            type: "message",
            role: "assistant",
            channel: event.payload.channel,
            content: event.payload.delta,
          };
          assistantMessages.set(event.payload.messageId, nextMessage);
          history.push(nextMessage);
          break;
        }
        case "tool.requested":
          history.push({
            type: "tool_call",
            toolCallId: event.payload.toolCallId,
            toolName: event.payload.toolName,
            input: this.#parseToolInput(
              event.payload.argsPreview,
              event.payload.input,
            ),
          });
          break;
        case "message.assistant.completed": {
          const assistantMessage = assistantMessages.get(
            event.payload.messageId,
          );
          if (assistantMessage && event.payload.reason) {
            assistantMessage.reason = event.payload.reason;
          }
          break;
        }
        case "tool.completed":
          history.push({
            type: "tool_result",
            toolCallId: event.payload.toolCallId,
            output:
              event.payload.modelOutput ?? event.payload.resultPreview ?? "",
          });
          break;
        case "tool.failed":
          history.push({
            type: "tool_result",
            toolCallId: event.payload.toolCallId,
            output:
              event.payload.modelOutput ??
              `Tool execution failed: ${event.payload.error}`,
          });
          break;
      }
    }

    return history;
  };
}
