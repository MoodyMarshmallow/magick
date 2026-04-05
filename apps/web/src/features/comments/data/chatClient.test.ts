// @vitest-environment jsdom

import type {
  CommandResponseEnvelope,
  ServerPushEnvelope,
} from "@magick/contracts/ws";
import { parseChatMessageData } from "./chatClient";

describe("chatClient message parsing", () => {
  it("parses string websocket payloads", async () => {
    await expect(
      parseChatMessageData(
        JSON.stringify({
          requestId: "request_1",
          result: {
            ok: true,
            data: { kind: "accepted", threadId: "thread_1" },
          },
        } satisfies CommandResponseEnvelope),
      ),
    ).resolves.toMatchObject({
      requestId: "request_1",
    });
  });

  it("parses blob websocket payloads", async () => {
    const blob = new Blob([
      JSON.stringify({
        channel: "orchestration.domainEvent",
        threadId: "thread_1",
        event: {
          eventId: "event_1",
          threadId: "thread_1",
          providerSessionId: "session_1",
          sequence: 1,
          occurredAt: "2026-04-05T00:00:00.000Z",
          type: "thread.renamed",
          payload: { title: "Renamed" },
        },
      } satisfies ServerPushEnvelope),
    ]);

    await expect(parseChatMessageData(blob)).resolves.toMatchObject({
      channel: "orchestration.domainEvent",
      event: {
        type: "thread.renamed",
      },
    });
  });
});
