import { setTimeout as delay } from "node:timers/promises";

import type { ProviderCapabilities } from "../../../../../packages/contracts/src/provider";
import type {
  CreateProviderSessionInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderError,
  ProviderEvent,
  ProviderSessionHandle,
  ProviderTurnHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
} from "../providerTypes";

type FakeProviderMode = "stateful" | "stateless";

export interface FakeProviderAdapterOptions {
  readonly key?: string;
  readonly mode: FakeProviderMode;
  readonly chunkDelayMs?: number;
  readonly responder?: (input: StartTurnInput) => string;
}

class FakeProviderTurn implements ProviderTurnHandle {
  readonly turnId: string;
  readonly #input: StartTurnInput;
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => string;
  readonly #interruptedTurns: Set<string>;

  constructor(
    input: StartTurnInput,
    interruptedTurns: Set<string>,
    chunkDelayMs: number,
    responder: (input: StartTurnInput) => string,
  ) {
    this.turnId = input.turnId;
    this.#input = input;
    this.#interruptedTurns = interruptedTurns;
    this.#chunkDelayMs = chunkDelayMs;
    this.#responder = responder;
  }

  async *events(): AsyncIterable<ProviderEvent> {
    const content = this.#responder(this.#input);
    const chunks = content.match(/.{1,8}/g) ?? [content];

    for (const chunk of chunks) {
      if (this.#interruptedTurns.has(this.turnId)) {
        return;
      }

      if (this.#chunkDelayMs > 0) {
        await delay(this.#chunkDelayMs);
      }

      yield {
        type: "output.delta",
        turnId: this.turnId,
        messageId: this.#input.messageId,
        delta: chunk,
      };
    }

    if (this.#interruptedTurns.has(this.turnId)) {
      return;
    }

    yield {
      type: "output.completed",
      turnId: this.turnId,
      messageId: this.#input.messageId,
    };
  }
}

class FakeProviderSession implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly #interruptedTurns = new Set<string>();
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => string;
  readonly observedInputs: StartTurnInput[] = [];

  constructor(
    sessionId: string,
    providerSessionRef: string | null,
    providerThreadRef: string | null,
    chunkDelayMs: number,
    responder: (input: StartTurnInput) => string,
  ) {
    this.sessionId = sessionId;
    this.providerSessionRef = providerSessionRef;
    this.providerThreadRef = providerThreadRef;
    this.#chunkDelayMs = chunkDelayMs;
    this.#responder = responder;
  }

  async startTurn(input: StartTurnInput): Promise<ProviderTurnHandle> {
    this.observedInputs.push(input);
    return new FakeProviderTurn(
      input,
      this.#interruptedTurns,
      this.#chunkDelayMs,
      this.#responder,
    );
  }

  async interruptTurn(input: InterruptTurnInput): Promise<void> {
    this.#interruptedTurns.add(input.turnId);
  }

  async dispose(): Promise<void> {}
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly key: string;
  readonly #mode: FakeProviderMode;
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => string;
  readonly sessions = new Map<string, FakeProviderSession>();

  constructor(options: FakeProviderAdapterOptions) {
    this.key = options.key ?? "fake";
    this.#mode = options.mode;
    this.#chunkDelayMs = options.chunkDelayMs ?? 0;
    this.#responder =
      options.responder ??
      ((input) =>
        `${this.#mode}:${input.contextMessages.map((message) => message.content).join(" | ")} => ${input.userMessage}`);
  }

  listCapabilities(): ProviderCapabilities {
    return {
      supportsNativeResume: this.#mode === "stateful",
      supportsInterrupt: true,
      supportsAttachments: false,
      supportsToolCalls: false,
      supportsApprovals: false,
      supportsServerSideSessions: this.#mode === "stateful",
    };
  }

  getResumeStrategy() {
    return this.#mode === "stateful" ? "native" : "rebuild";
  }

  async createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSessionHandle> {
    const session = new FakeProviderSession(
      input.sessionId,
      this.#mode === "stateful" ? `${input.sessionId}:provider` : null,
      this.#mode === "stateful" ? `${input.workspaceId}:thread` : null,
      this.#chunkDelayMs,
      this.#responder,
    );
    this.sessions.set(input.sessionId, session);
    return session;
  }

  async resumeSession(
    input: ResumeProviderSessionInput,
  ): Promise<ProviderSessionHandle> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      return existing;
    }

    const session = new FakeProviderSession(
      input.sessionId,
      input.providerSessionRef,
      input.providerThreadRef,
      this.#chunkDelayMs,
      this.#responder,
    );
    this.sessions.set(input.sessionId, session);
    return session;
  }

  normalizeError(error: unknown): ProviderError {
    return {
      code: "fake_provider_error",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
