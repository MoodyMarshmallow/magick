import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspaceService } from "./localWorkspaceService";

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "magick-desktop-"));
  let tick = 0;
  let idCounter = 0;
  const service = new LocalWorkspaceService({
    workspaceDir: join(root, "workspace"),
    now: () => `2026-03-29T10:00:${String(tick++).padStart(2, "0")}.000Z`,
    createId: () => `${++idCounter}`.padStart(4, "0"),
  });

  return {
    root,
    service,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
};

describe("LocalWorkspaceService", () => {
  it("seeds a local workspace with documents and thread counts", () => {
    const harness = createHarness();

    try {
      const bootstrap = harness.service.getWorkspaceBootstrap();
      const fieldNotes = bootstrap.documents.find(
        (document) => document.documentId === "doc_field_notes",
      );

      if (!fieldNotes) {
        throw new Error("Expected field notes document to exist.");
      }

      expect(bootstrap.documents).toHaveLength(2);
      expect(fieldNotes).toMatchObject({
        documentId: "doc_field_notes",
        threadCount: 1,
      });
    } finally {
      harness.cleanup();
    }
  });

  it("opens a document with local markdown and thread history", () => {
    const harness = createHarness();

    try {
      const document = harness.service.openDocument("doc_evergreen");

      expect(document.title).toBe("Evergreen Systems Memo");
      expect(document.markdown).toContain(
        "Magick should feel like a calm studio",
      );
      expect(document.threads[0]).toMatchObject({
        threadId: "thread_seed_1",
        title: "Thread 1",
      });
    } finally {
      harness.cleanup();
    }
  });

  it("persists document saves to disk", () => {
    const harness = createHarness();

    try {
      const document = harness.service.openDocument("doc_field_notes");
      harness.service.saveDocument(document.documentId, "Fresh local markdown");
      const savedDocument = harness.service
        .getWorkspaceBootstrap()
        .documents.find(
          (documentSummary) =>
            documentSummary.documentId === document.documentId,
        );

      if (!savedDocument) {
        throw new Error("Expected saved document summary to exist.");
      }

      expect(readFileSync(savedDocument.filePath, "utf8")).toContain(
        "Fresh local markdown",
      );
    } finally {
      harness.cleanup();
    }
  });

  it("appends local user and assistant messages when sending to a thread", () => {
    const harness = createHarness();

    try {
      const events = harness.service.sendThreadMessage(
        "thread_seed_1",
        "Desktop verification message",
      );

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "message.added",
        threadId: "thread_seed_1",
      });
      const updatedThread =
        harness.service.openDocument("doc_evergreen").threads[0];
      expect(updatedThread?.messages.at(-2)?.body).toBe(
        "Desktop verification message",
      );
      expect(updatedThread?.messages.at(-1)?.author).toBe("ai");
    } finally {
      harness.cleanup();
    }
  });

  it("toggles thread status locally", () => {
    const harness = createHarness();

    try {
      const resolvedEvent =
        harness.service.toggleThreadResolved("thread_seed_1");
      const reopenedEvent =
        harness.service.toggleThreadResolved("thread_seed_1");

      expect(resolvedEvent).toMatchObject({ status: "resolved" });
      expect(reopenedEvent).toMatchObject({ status: "open" });
    } finally {
      harness.cleanup();
    }
  });
});
