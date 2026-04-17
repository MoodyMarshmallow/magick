import { Effect } from "effect";

import { ProviderRegistry } from "../../providers/providerRegistry";
import { ProviderFailureError } from "../../runtime/errors";
import {
  createThreadRecord,
  createThreadViewModel,
} from "../test-support/threadTestSupport";
import { ThreadAutoTitleService } from "./threadAutoTitleService";

describe("ThreadAutoTitleService", () => {
  it("only auto-names untouched new chats before the first user message", () => {
    const service = new ThreadAutoTitleService({
      providerRegistry: new ProviderRegistry([]),
      renameThread: async () => createThreadViewModel(),
    });

    expect(
      service.shouldAutoNameThread({
        thread: createThreadRecord({ title: "New chat" }),
        snapshot: createThreadViewModel({ messages: [] }),
      }),
    ).toBe(true);
    expect(
      service.shouldAutoNameThread({
        thread: createThreadRecord({ title: "Named chat" }),
        snapshot: createThreadViewModel({ messages: [] }),
      }),
    ).toBe(false);
    expect(
      service.shouldAutoNameThread({
        thread: createThreadRecord({ title: "New chat" }),
        snapshot: createThreadViewModel({
          messages: [
            {
              id: "message_1",
              role: "user",
              channel: null,
              content: "First",
              status: "complete",
              createdAt: "2026-04-17T00:00:00.000Z",
            },
          ],
        }),
      }),
    ).toBe(false);
  });

  it("renames the thread when the provider generates a non-empty title", async () => {
    const renameThread = vi.fn().mockResolvedValue(createThreadViewModel());
    const service = new ThreadAutoTitleService({
      providerRegistry: new ProviderRegistry([
        {
          key: "fake",
          listCapabilities: () => ({
            supportsNativeResume: false,
            supportsInterrupt: true,
            supportsAttachments: false,
            supportsToolCalls: false,
            supportsApprovals: false,
            supportsServerSideSessions: false,
          }),
          getResumeStrategy: () => "rebuild" as const,
          createSession: vi.fn(),
          resumeSession: vi.fn(),
          generateThreadTitle: vi
            .fn()
            .mockReturnValue(Effect.succeed("A title")),
        },
      ]),
      renameThread,
    });

    await Effect.runPromise(
      service.autoNameThreadFromFirstMessage({
        thread: createThreadRecord(),
        content: "Name this chat",
      }),
    );

    expect(renameThread).toHaveBeenCalledWith("thread_1", "A title");
  });

  it("ignores blank titles and swallows provider lookup, generation, and rename failures", async () => {
    const blankRename = vi.fn();
    const blankService = new ThreadAutoTitleService({
      providerRegistry: new ProviderRegistry([
        {
          key: "fake",
          listCapabilities: () => ({
            supportsNativeResume: false,
            supportsInterrupt: true,
            supportsAttachments: false,
            supportsToolCalls: false,
            supportsApprovals: false,
            supportsServerSideSessions: false,
          }),
          getResumeStrategy: () => "rebuild" as const,
          createSession: vi.fn(),
          resumeSession: vi.fn(),
          generateThreadTitle: vi.fn().mockReturnValue(Effect.succeed("   ")),
        },
      ]),
      renameThread: blankRename,
    });

    await Effect.runPromise(
      blankService.autoNameThreadFromFirstMessage({
        thread: createThreadRecord(),
        content: "Name this chat",
      }),
    );
    expect(blankRename).not.toHaveBeenCalled();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lookupFailureService = new ThreadAutoTitleService({
      providerRegistry: new ProviderRegistry([]),
      renameThread: async () => createThreadViewModel(),
    });
    await Effect.runPromise(
      lookupFailureService.autoNameThreadFromFirstMessage({
        thread: createThreadRecord({ providerKey: "missing" }),
        content: "Name this chat",
      }),
    );

    const failingProviderService = new ThreadAutoTitleService({
      providerRegistry: new ProviderRegistry([
        {
          key: "fake",
          listCapabilities: () => ({
            supportsNativeResume: false,
            supportsInterrupt: true,
            supportsAttachments: false,
            supportsToolCalls: false,
            supportsApprovals: false,
            supportsServerSideSessions: false,
          }),
          getResumeStrategy: () => "rebuild" as const,
          createSession: vi.fn(),
          resumeSession: vi.fn(),
          generateThreadTitle: vi.fn().mockReturnValue(
            Effect.fail(
              new ProviderFailureError({
                providerKey: "fake",
                code: "title_failed",
                detail: "boom",
                retryable: false,
              }),
            ),
          ),
        },
      ]),
      renameThread: vi.fn().mockRejectedValue(new Error("persist failed")),
    });
    await Effect.runPromise(
      failingProviderService.autoNameThreadFromFirstMessage({
        thread: createThreadRecord(),
        content: "Name this chat",
      }),
    );

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
