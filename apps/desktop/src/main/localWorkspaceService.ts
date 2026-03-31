import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  LocalDocumentPayload,
  LocalDocumentThread,
  LocalThreadEvent,
  LocalThreadMessage,
  LocalThreadStatus,
  LocalWorkspaceBootstrap,
} from "@magick/shared/localWorkspace";
import { createWorkspaceBootstrap } from "./localWorkspaceTree";

interface LocalWorkspaceServiceOptions {
  readonly workspaceDir: string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

interface StoredDocument {
  id: string;
  title: string;
  filePath: string;
  updatedAt: string;
}

interface StoredWorkspace {
  documents: StoredDocument[];
  threads: StoredThread[];
}

interface StoredThread {
  threadId: string;
  documentId: string;
  title: string;
  status: LocalThreadStatus;
  updatedAt: string;
  messages: LocalThreadMessage[];
}

const seedDocuments = [
  {
    id: "doc_evergreen",
    title: "Evergreen Systems Memo",
    fileName: "codex/evergreen-systems-memo.md",
    markdown:
      "Magick should feel like a calm studio for thinking with AI.\n\nThe best interfaces keep momentum without hiding system state.\n\nUse shared contracts to keep streaming and replay predictable.\n\nWe should treat threads like durable conversations, not disposable UI fragments.",
    thread: {
      id: "thread_seed_1",
      title: "Thread 1",
      human: "We should preserve the line about replay semantics.",
      ai: "Agreed. It explains why predictable recovery matters more than flashy interaction tricks.",
    },
  },
  {
    id: "doc_field_notes",
    title: "Design System Field Notes",
    fileName: "notes/patterns/design-system-field-notes.md",
    markdown:
      "Keep the interface flat, direct, and readable.\n\nAvoid decorative layering that competes with the writing surface.\n\nFavor thread chat over annotation theater for now.",
    thread: {
      id: "thread_seed_2",
      title: "Thread 1",
      human: "This document should stay simpler than the manifesto.",
      ai: "Yes. It works better as a plain local note with a single thread history.",
    },
  },
] as const;

export class LocalWorkspaceService {
  private readonly workspaceDir: string;
  private readonly documentsDir: string;
  private readonly metadataPath: string;
  private readonly now: () => string;
  private readonly createId: () => string;

  public constructor(options: LocalWorkspaceServiceOptions) {
    this.workspaceDir = options.workspaceDir;
    this.documentsDir = join(this.workspaceDir, "documents");
    this.metadataPath = join(this.workspaceDir, "workspace.json");
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => crypto.randomUUID().slice(0, 8));

    mkdirSync(this.documentsDir, { recursive: true });
    this.seedWorkspaceIfEmpty();
  }

  public getWorkspaceBootstrap(): LocalWorkspaceBootstrap {
    const state = this.readWorkspace();
    return createWorkspaceBootstrap({
      documents: state.documents,
      threads: state.threads,
      documentsDir: this.documentsDir,
    });
  }

  public openDocument(documentId: string): LocalDocumentPayload {
    const state = this.readWorkspace();
    const document = state.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!document) {
      throw new Error(`Document '${documentId}' was not found.`);
    }

    return {
      documentId: document.id,
      title: document.title,
      markdown: readFileSync(document.filePath, "utf8"),
      threads: state.threads
        .filter((thread) => thread.documentId === document.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  public saveDocument(documentId: string, markdown: string): void {
    const state = this.readWorkspace();
    const document = state.documents.find(
      (candidate) => candidate.id === documentId,
    );
    if (!document) {
      throw new Error(`Document '${documentId}' was not found.`);
    }

    writeFileSync(document.filePath, markdown, "utf8");
    document.updatedAt = this.now();
    this.writeWorkspace(state);
  }

  public sendThreadMessage(threadId: string, body: string): LocalThreadEvent[] {
    const state = this.readWorkspace();
    const thread = state.threads.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!thread) {
      throw new Error(`Thread '${threadId}' was not found.`);
    }

    const humanMessage = this.createMessage("human", body, "complete");
    const aiMessage = this.createMessage(
      "ai",
      `Local desktop stored this reply in ${thread.threadId}. The thread history now lives entirely on your machine.`,
      "complete",
    );

    thread.messages = [...thread.messages, humanMessage, aiMessage];
    thread.updatedAt = aiMessage.createdAt;
    this.writeWorkspace(state);

    return [
      {
        type: "message.added",
        threadId: thread.threadId,
        message: humanMessage,
        updatedAt: humanMessage.createdAt,
      },
      {
        type: "message.added",
        threadId: thread.threadId,
        message: aiMessage,
        updatedAt: aiMessage.createdAt,
      },
    ];
  }

  public toggleThreadResolved(threadId: string): LocalThreadEvent {
    const state = this.readWorkspace();
    const thread = state.threads.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!thread) {
      throw new Error(`Thread '${threadId}' was not found.`);
    }

    thread.status = thread.status === "open" ? "resolved" : "open";
    thread.updatedAt = this.now();
    this.writeWorkspace(state);

    return {
      type: "thread.statusChanged",
      threadId: thread.threadId,
      status: thread.status,
      updatedAt: thread.updatedAt,
    };
  }

  private seedWorkspaceIfEmpty(): void {
    try {
      this.readWorkspace();
      return;
    } catch {
      const state: StoredWorkspace = {
        documents: [],
        threads: [],
      };

      for (const document of seedDocuments) {
        const updatedAt = this.now();
        const filePath = join(this.documentsDir, document.fileName);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, document.markdown, "utf8");
        state.documents.push({
          id: document.id,
          title: document.title,
          filePath,
          updatedAt,
        });
        state.threads.push({
          threadId: document.thread.id,
          documentId: document.id,
          title: document.thread.title,
          status: "open",
          updatedAt,
          messages: [
            this.createMessage("human", document.thread.human, "complete"),
            this.createMessage("ai", document.thread.ai, "complete"),
          ],
        });
      }

      this.writeWorkspace(state);
    }
  }

  private createMessage(
    author: LocalThreadMessage["author"],
    body: string,
    status: LocalThreadMessage["status"],
  ): LocalThreadMessage {
    return {
      id: `message_${this.createId()}`,
      author,
      body,
      createdAt: this.now(),
      status,
    };
  }

  private readWorkspace(): StoredWorkspace {
    return JSON.parse(
      readFileSync(this.metadataPath, "utf8"),
    ) as StoredWorkspace;
  }

  private writeWorkspace(state: StoredWorkspace): void {
    writeFileSync(this.metadataPath, JSON.stringify(state, null, 2), "utf8");
  }
}
