import type { BranchViewModel } from "@magick/contracts/chat";
import { Cause, Effect, Exit, Option, Stream } from "effect";
import {
  type BackendError,
  InvalidStateError,
  type ProviderFailureError,
  backendErrorMessage,
} from "../../shared/errors";
import type { ClockService, IdGeneratorService } from "../../shared/runtime";
import type { ContextCoreInterface } from "../context-core/contextCoreInterface";
import type {
  ProviderRuntimeEvent,
  ProviderRuntimeInterface,
} from "../provider-runtime/providerRuntimeInterface";
import type {
  ToolRuntimeCall,
  ToolRuntimeInterface,
} from "../tool-runtime/toolRuntimeInterface";
import type { AssistantTurnEngineInterface } from "./assistantTurnEngineInterface";

type PendingToolCall = Extract<
  ProviderRuntimeEvent,
  { readonly type: "tool.call.requested" }
>;

const runStream = async (
  stream: Stream.Stream<ProviderRuntimeEvent, ProviderFailureError>,
  apply: (event: ProviderRuntimeEvent) => Promise<void>,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(
    Stream.runForEach(stream, (event) => Effect.promise(() => apply(event))),
  );
  if (Exit.isSuccess(exit)) {
    return;
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }
  throw new Error("Unhandled provider stream failure");
};

export class AssistantTurnEngine implements AssistantTurnEngineInterface {
  readonly #contextCore: ContextCoreInterface;
  readonly #providerRuntime: ProviderRuntimeInterface;
  readonly #toolRuntime: ToolRuntimeInterface;
  readonly #clock: ClockService;
  readonly #idGenerator: IdGeneratorService;
  readonly #defaultAssistantInstructions: string;
  readonly #publishBranchUpdate: (branch: BranchViewModel) => Promise<void>;

  constructor(args: {
    readonly contextCore: ContextCoreInterface;
    readonly providerRuntime: ProviderRuntimeInterface;
    readonly toolRuntime: ToolRuntimeInterface;
    readonly clock: ClockService;
    readonly idGenerator: IdGeneratorService;
    readonly defaultAssistantInstructions: string;
    readonly publishBranchUpdate: (branch: BranchViewModel) => Promise<void>;
  }) {
    this.#contextCore = args.contextCore;
    this.#providerRuntime = args.providerRuntime;
    this.#toolRuntime = args.toolRuntime;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
    this.#defaultAssistantInstructions = args.defaultAssistantInstructions;
    this.#publishBranchUpdate = args.publishBranchUpdate;
  }

  async sendMessage(input: {
    readonly bookmarkId: string;
    readonly content: string;
  }): Promise<BranchViewModel> {
    const current = this.#contextCore.buildBranchView({
      bookmarkId: input.bookmarkId,
    });
    if (current.activeTurnId) {
      throw new InvalidStateError({
        code: "turn_already_running",
        detail: `Bookmark '${input.bookmarkId}' already has an active turn.`,
      });
    }

    const turnId = this.#idGenerator.next("turn");
    const userMessageId = this.#idGenerator.next("message");
    const assistantMessageId = this.#idGenerator.next("message");

    await this.#publish(
      this.#contextCore.appendUserMessage({
        bookmarkId: input.bookmarkId,
        messageId: userMessageId,
        content: input.content,
      }),
    );
    await this.#publish(
      this.#contextCore.setBookmarkRuntimeState({
        bookmarkId: input.bookmarkId,
        runtimeState: "running",
        activeTurnId: turnId,
      }),
    );

    try {
      const payload = this.#contextCore.buildProviderPayload({
        bookmarkId: input.bookmarkId,
      });
      const branch = this.#contextCore.buildBranchView({
        bookmarkId: input.bookmarkId,
      });
      const stream = await this.#providerRuntime.startTurn({
        bookmarkId: input.bookmarkId,
        providerKey: branch.providerKey,
        turnId,
        messageId: assistantMessageId,
        userMessage: input.content,
        instructions:
          payload.instructions || this.#defaultAssistantInstructions,
        historyItems: payload.historyItems,
        tools: this.#toolRuntime.listProviderTools(),
      });
      await this.#runProviderStep({
        bookmarkId: input.bookmarkId,
        turnId,
        stream,
      });
      await this.#publish(
        this.#contextCore.setBookmarkRuntimeState({
          bookmarkId: input.bookmarkId,
          runtimeState: "idle",
          activeTurnId: null,
        }),
      );
    } catch (error) {
      await this.#publish(
        this.#contextCore.setBookmarkRuntimeState({
          bookmarkId: input.bookmarkId,
          runtimeState: "failed",
          activeTurnId: null,
          lastError: this.#errorMessage(error),
        }),
      );
    }

    return this.#contextCore.buildBranchView({ bookmarkId: input.bookmarkId });
  }

  async stopTurn(input: {
    readonly bookmarkId: string;
  }): Promise<BranchViewModel> {
    const branch = this.#contextCore.buildBranchView({
      bookmarkId: input.bookmarkId,
    });
    if (!branch.activeTurnId) {
      return branch;
    }

    await this.#providerRuntime.interruptTurn({
      bookmarkId: input.bookmarkId,
      turnId: branch.activeTurnId,
      reason: "Interrupted by user",
    });
    const updated = this.#contextCore.setBookmarkRuntimeState({
      bookmarkId: input.bookmarkId,
      runtimeState: "interrupted",
      activeTurnId: null,
      lastError: "Interrupted by user",
    });
    await this.#publish(updated);
    return updated;
  }

  async retryTurn(input: {
    readonly bookmarkId: string;
  }): Promise<BranchViewModel> {
    const branch = this.#contextCore.buildBranchView({
      bookmarkId: input.bookmarkId,
    });
    const lastUserMessage = [...branch.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUserMessage) {
      throw new InvalidStateError({
        code: "retry_not_possible",
        detail: `Bookmark '${input.bookmarkId}' has no user message to retry.`,
      });
    }
    return this.sendMessage({
      bookmarkId: input.bookmarkId,
      content: lastUserMessage.content,
    });
  }

  async #runProviderStep(input: {
    readonly bookmarkId: string;
    readonly turnId: string;
    readonly stream: Stream.Stream<ProviderRuntimeEvent, ProviderFailureError>;
  }): Promise<void> {
    const pendingToolCalls: PendingToolCall[] = [];
    const assistantNodes = new Set<string>();

    await runStream(input.stream, async (event) => {
      switch (event.type) {
        case "output.delta":
          if (!assistantNodes.has(event.messageId)) {
            assistantNodes.add(event.messageId);
            await this.#publish(
              this.#contextCore.beginAssistantMessage({
                bookmarkId: input.bookmarkId,
                turnId: event.turnId,
                messageId: event.messageId,
                channel: event.channel,
              }),
            );
          }
          await this.#publish(
            this.#contextCore.appendAssistantDelta({
              bookmarkId: input.bookmarkId,
              messageId: event.messageId,
              delta: event.delta,
            }),
          );
          break;
        case "output.message.completed":
          if (!assistantNodes.has(event.messageId)) {
            assistantNodes.add(event.messageId);
            await this.#publish(
              this.#contextCore.beginAssistantMessage({
                bookmarkId: input.bookmarkId,
                turnId: event.turnId,
                messageId: event.messageId,
                channel: event.channel,
              }),
            );
          }
          await this.#publish(
            this.#contextCore.completeAssistantMessage({
              bookmarkId: input.bookmarkId,
              messageId: event.messageId,
              reason: event.reason,
            }),
          );
          break;
        case "tool.call.requested":
          pendingToolCalls.push(event);
          break;
        case "turn.failed":
          throw new InvalidStateError({
            code: "provider_turn_failed",
            detail: event.error,
          });
        case "session.disconnected":
        case "session.recovered":
        case "turn.completed":
          break;
      }
    });

    if (pendingToolCalls.length === 0) {
      return;
    }

    await this.#appendAndExecuteToolCalls(input.bookmarkId, pendingToolCalls);
    const payload = this.#contextCore.buildProviderPayload({
      bookmarkId: input.bookmarkId,
    });
    const continuation = await this.#providerRuntime.continueTurn({
      bookmarkId: input.bookmarkId,
      turnId: input.turnId,
      instructions: payload.instructions || this.#defaultAssistantInstructions,
      historyItems: payload.historyItems,
      tools: this.#toolRuntime.listProviderTools(),
      toolResults: pendingToolCalls.map((call) => {
        const toolResult = payload.historyItems
          .filter((item) => item.type === "tool_result")
          .find((item) => item.toolCallId === call.toolCallId);
        return {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: toolResult?.output ?? "",
        };
      }),
    });
    await this.#runProviderStep({
      bookmarkId: input.bookmarkId,
      turnId: input.turnId,
      stream: continuation,
    });
  }

  async #appendAndExecuteToolCalls(
    bookmarkId: string,
    toolCalls: readonly PendingToolCall[],
  ): Promise<void> {
    const executableCalls: ToolRuntimeCall[] = [];
    for (const call of toolCalls) {
      executableCalls.push(call);
      await this.#publish(
        this.#contextCore.appendToolCall({
          bookmarkId,
          turnId: call.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          title: call.toolName,
          argsPreview: JSON.stringify(call.input),
          input: call.input,
          path:
            typeof call.input === "object" && call.input && "path" in call.input
              ? String(call.input.path)
              : null,
          url:
            typeof call.input === "object" && call.input && "url" in call.input
              ? String(call.input.url)
              : null,
        }),
      );
    }

    const results = await this.#toolRuntime.executeToolCalls({
      bookmarkId,
      calls: executableCalls,
    });
    for (const result of results) {
      await this.#publish(
        this.#contextCore.appendToolResult({
          bookmarkId,
          turnId: result.turnId,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          status: result.status,
          resultPreview: result.resultPreview,
          modelOutput: result.modelOutput,
          path: result.path,
          url: result.url,
          diff: result.diff,
          error: result.error,
        }),
      );
    }
  }

  async #publish(branch: BranchViewModel): Promise<void> {
    await this.#publishBranchUpdate(branch);
  }

  #errorMessage(error: unknown): string {
    if (error instanceof InvalidStateError) {
      return backendErrorMessage(error as BackendError);
    }
    return error instanceof Error ? error.message : String(error);
  }
}
