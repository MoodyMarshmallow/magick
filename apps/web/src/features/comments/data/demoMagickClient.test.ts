import {
  type DemoMagickClientOptions,
  createDemoMagickClient,
} from "./demoMagickClient";

const createHarness = () => {
  let idCounter = 0;
  let timeCounter = 0;
  let handleCounter = 0;
  const scheduled = new Map<number, () => void>();

  const options: DemoMagickClientOptions = {
    now: () =>
      `2026-03-27T10:00:${String(timeCounter++).padStart(2, "0")}.000Z`,
    createId: () => `${++idCounter}`.padStart(4, "0"),
    schedule: (callback) => {
      const handle = ++handleCounter;
      scheduled.set(handle, callback);
      return handle;
    },
    cancelSchedule: (handle) => {
      scheduled.delete(handle as number);
    },
  };

  const flushScheduled = () => {
    while (scheduled.size > 0) {
      for (const [handle, callback] of [...scheduled.entries()]) {
        if (!scheduled.has(handle)) {
          continue;
        }

        callback();
      }
    }
  };

  return {
    client: createDemoMagickClient(options),
    flushScheduled,
  };
};

describe("demoMagickClient", () => {
  it("returns an isolated bootstrap snapshot", async () => {
    const { client } = createHarness();
    const threads = await client.getThreads();

    const firstThread = threads[0];
    if (!firstThread) {
      throw new Error("Expected seed thread to exist.");
    }
    (firstThread as { title: string }).title = "mutated";

    const nextThreads = await client.getThreads();

    expect(nextThreads[0]?.title).toBe("Chat 1");
  });

  it("throws when a document id is unknown", async () => {
    const { client } = createHarness();

    await expect(client.getDocumentBootstrap("missing_doc")).rejects.toThrow(
      "Document 'missing_doc' was not found.",
    );
  });

  it("persists document markup independently from chat state", async () => {
    const { client } = createHarness();

    client.updateDocumentMarkup(
      "doc_everforest_manifesto",
      "next markdown state",
    );

    const bootstrap = await client.getDocumentBootstrap(
      "doc_everforest_manifesto",
    );

    expect(bootstrap.markdown).toBe("next markdown state");
  });

  it("supports multiple demo documents", async () => {
    const { client } = createHarness();

    const note = await client.getDocumentBootstrap("doc_systems_note");

    expect(note.title).toBe("Systems Garden Note");
    expect(note.markdown).toContain("shared draft state");
  });

  it("creates a new chat and emits streaming lifecycle events", async () => {
    const { client, flushScheduled } = createHarness();
    const events: string[] = [];

    client.subscribe((event) => {
      events.push(event.type);
    });

    const thread = await client.createCommentThread({
      title: "Chat 2",
      initialMessage: "First note",
    });

    expect(thread.threadId).toBe("thread_0001");
    expect(thread.messages[0]).toMatchObject({
      author: "human",
      body: "First note",
    });

    flushScheduled();

    const threads = await client.getThreads();
    const persistedThread = threads.find(
      (candidate) => candidate.threadId === thread.threadId,
    );

    expect(events).toContain("thread.created");
    expect(events).toContain("message.added");
    expect(events).toContain("message.delta");
    expect(events).toContain("message.completed");
    expect(persistedThread?.messages.at(-1)).toMatchObject({
      author: "ai",
      status: "complete",
    });
  });

  it("keeps replies on the existing chat instead of creating a new one", async () => {
    const { client, flushScheduled } = createHarness();
    const before = await client.getThreads();

    await client.sendReply({
      threadId: "thread_seed_1",
      body: "Follow-up reply",
    });
    flushScheduled();

    const after = await client.getThreads();
    const thread = after.find(
      (candidate) => candidate.threadId === "thread_seed_1",
    );

    expect(after).toHaveLength(before.length);
    expect(
      thread?.messages.some((message) => message.body === "Follow-up reply"),
    ).toBe(true);
  });

  it("toggles resolved state and supports unsubscribe", async () => {
    const { client } = createHarness();
    const events: string[] = [];
    const unsubscribe = client.subscribe((event) => {
      events.push(event.type);
    });

    await client.toggleResolved("thread_seed_1");
    unsubscribe();
    await client.toggleResolved("thread_seed_1");

    const threads = await client.getThreads();
    const thread = threads.find(
      (candidate) => candidate.threadId === "thread_seed_1",
    );

    expect(events).toEqual(["thread.statusChanged"]);
    expect(thread?.status).toBe("open");
  });

  it("throws when replying to or toggling a missing thread", async () => {
    const { client } = createHarness();

    await expect(
      client.sendReply({ threadId: "missing_thread", body: "hello" }),
    ).rejects.toThrow("Thread 'missing_thread' was not found.");
    await expect(client.toggleResolved("missing_thread")).rejects.toThrow(
      "Thread 'missing_thread' was not found.",
    );
  });
});
