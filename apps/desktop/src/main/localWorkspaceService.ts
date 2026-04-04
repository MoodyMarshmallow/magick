import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  LocalDocumentPayload,
  LocalFilePayload,
  LocalThreadEvent,
  LocalThreadMessage,
  LocalThreadStatus,
  LocalWorkspaceBootstrap,
  LocalWorkspaceFilesBootstrap,
  LocalWorkspaceThread,
} from "@magick/shared/localWorkspace";
import {
  createWorkspaceBootstrap,
  createWorkspaceFilesBootstrap,
} from "./localWorkspaceTree";

interface LocalWorkspaceServiceOptions {
  readonly workspaceDir: string;
}

const ignoredDirectoryNames = new Set([".git", ".magick", "node_modules"]);
const supportedFileExtensions = new Set([".md", ".mdx", ".txt"]);
const legacyThreadStoreFileName = "workspace.json";

const toPosixPath = (filePath: string): string => filePath.split(sep).join("/");

const toTitleFromFilePath = (filePath: string): string => {
  const fileName = basename(filePath, extname(filePath));
  return fileName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const createThreadReply = (threadId: string): string =>
  `This reply stays in ${threadId}, which keeps the chat durable across local restarts.`;

const createSeedThreads = (): MutableLocalWorkspaceThread[] => {
  const now = new Date().toISOString();
  return [
    {
      threadId: "thread_seed_1",
      title: "Chat 1",
      status: "open",
      updatedAt: now,
      messages: [
        {
          id: "message_seed_1",
          author: "human",
          body: "We should preserve this sentence. It explains why local history matters.",
          createdAt: now,
          status: "complete",
        },
        {
          id: "message_seed_2",
          author: "ai",
          body: "Agreed. Local desktop history should survive restarts until Codex fully replaces it.",
          createdAt: now,
          status: "complete",
        },
      ],
    },
    {
      threadId: "thread_seed_2",
      title: "Chat 2",
      status: "resolved",
      updatedAt: now,
      messages: [],
    },
  ];
};

interface PersistedThreadStore {
  readonly threads: readonly LocalWorkspaceThread[];
}

interface MutableLocalThreadMessage {
  id: string;
  author: LocalThreadMessage["author"];
  body: string;
  createdAt: string;
  status: LocalThreadMessage["status"];
}

interface MutableLocalWorkspaceThread {
  threadId: string;
  title: string;
  status: LocalThreadStatus;
  updatedAt: string;
  messages: MutableLocalThreadMessage[];
}

export class LocalWorkspaceService {
  private readonly workspaceDir: string;
  private readonly threadStorePath: string;
  private threads: MutableLocalWorkspaceThread[];

  public constructor(options: LocalWorkspaceServiceOptions) {
    const requestedWorkspaceDir = resolve(options.workspaceDir);
    mkdirSync(requestedWorkspaceDir, { recursive: true });
    this.workspaceDir = realpathSync(requestedWorkspaceDir);
    this.threadStorePath = this.resolveThreadStorePath();
    this.threads = this.loadThreads();
  }

  public getWorkspaceBootstrap(): LocalWorkspaceBootstrap {
    return createWorkspaceBootstrap({
      documents: this.listWorkspaceDocuments(),
      threads: this.toPublicThreads(),
      workspaceRoot: this.workspaceDir,
    });
  }

  public getFileWorkspaceBootstrap(): LocalWorkspaceFilesBootstrap {
    return createWorkspaceFilesBootstrap({
      documents: this.listWorkspaceDocuments(),
      workspaceRoot: this.workspaceDir,
    });
  }

  public openDocument(documentId: string): LocalDocumentPayload {
    const file = this.openFile(documentId);
    return {
      documentId: file.filePath,
      title: file.title,
      markdown: file.markdown,
    };
  }

  public openFile(filePath: string): LocalFilePayload {
    const absoluteFilePath = this.resolveWorkspaceFile(filePath);

    return {
      filePath,
      title: toTitleFromFilePath(filePath),
      markdown: readFileSync(absoluteFilePath, "utf8"),
    };
  }

  public saveDocument(documentId: string, markdown: string): void {
    this.saveFile(documentId, markdown);
  }

  public saveFile(filePath: string, markdown: string): void {
    const absoluteFilePath = this.resolveWorkspaceFile(filePath);
    writeFileSync(absoluteFilePath, markdown, "utf8");
  }

  public sendThreadMessage(threadId: string, body: string): LocalThreadEvent[] {
    const thread = this.findThread(threadId);
    const humanMessage: LocalThreadMessage = {
      id: `message_${crypto.randomUUID().slice(0, 8)}`,
      author: "human",
      body,
      createdAt: new Date().toISOString(),
      status: "complete",
    };
    const assistantMessageId = `message_${crypto.randomUUID().slice(0, 8)}`;
    const assistantCreatedAt = new Date().toISOString();
    const chunks = createThreadReply(threadId).match(/.{1,32}/g) ?? [
      createThreadReply(threadId),
    ];

    thread.messages = [...thread.messages, humanMessage];
    thread.updatedAt = humanMessage.createdAt;

    const streamingMessage: LocalThreadMessage = {
      id: assistantMessageId,
      author: "ai",
      body: "",
      createdAt: assistantCreatedAt,
      status: "streaming",
    };

    thread.messages = [...thread.messages, streamingMessage];
    thread.updatedAt = assistantCreatedAt;

    const events: LocalThreadEvent[] = [
      {
        type: "message.added",
        threadId,
        message: humanMessage,
        updatedAt: humanMessage.createdAt,
      },
      {
        type: "message.added",
        threadId,
        message: streamingMessage,
        updatedAt: assistantCreatedAt,
      },
    ];

    let accumulatedBody = "";
    for (const chunk of chunks) {
      accumulatedBody += chunk;
      events.push({
        type: "message.delta",
        threadId,
        messageId: assistantMessageId,
        delta: chunk,
        updatedAt: new Date().toISOString(),
      });
    }

    thread.messages = thread.messages.map(
      (message: MutableLocalThreadMessage) =>
        message.id === assistantMessageId
          ? { ...message, body: accumulatedBody, status: "complete" }
          : message,
    );
    thread.updatedAt = new Date().toISOString();
    this.persistThreads();

    events.push({
      type: "message.completed",
      threadId,
      messageId: assistantMessageId,
      updatedAt: thread.updatedAt,
    });
    return events;
  }

  public toggleThreadResolved(threadId: string): LocalThreadEvent {
    const thread = this.findThread(threadId);
    const nextStatus: LocalThreadStatus =
      thread.status === "open" ? "resolved" : "open";
    thread.status = nextStatus;
    thread.updatedAt = new Date().toISOString();
    this.persistThreads();
    return {
      type: "thread.statusChanged",
      threadId,
      status: nextStatus,
      updatedAt: thread.updatedAt,
    };
  }

  private listWorkspaceDocuments(): readonly { readonly filePath: string }[] {
    const documents: { filePath: string }[] = [];
    const visitDirectory = (directoryPath: string) => {
      const entries = readdirSync(directoryPath, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      );

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (ignoredDirectoryNames.has(entry.name)) {
            continue;
          }

          visitDirectory(join(directoryPath, entry.name));
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const nextPath = join(directoryPath, entry.name);
        if (!supportedFileExtensions.has(extname(nextPath).toLowerCase())) {
          continue;
        }

        documents.push({
          filePath: nextPath,
        });
      }
    };

    visitDirectory(this.workspaceDir);
    return documents;
  }

  private resolveWorkspaceFile(filePath: string): string {
    const normalizedPath = toPosixPath(filePath);
    const absolutePath = resolve(this.workspaceDir, normalizedPath);
    const relativeToRoot = relative(this.workspaceDir, absolutePath);

    if (
      relativeToRoot.startsWith("..") ||
      relativeToRoot === "" ||
      toPosixPath(relativeToRoot) !== normalizedPath
    ) {
      throw new Error(`File '${filePath}' is outside the workspace root.`);
    }

    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`File '${filePath}' was not found.`);
    }

    return absolutePath;
  }

  private resolveThreadStorePath(): string {
    const legacyStorePath = join(this.workspaceDir, legacyThreadStoreFileName);
    if (existsSync(legacyStorePath)) {
      return legacyStorePath;
    }

    return join(this.workspaceDir, ".magick", legacyThreadStoreFileName);
  }

  private loadThreads(): MutableLocalWorkspaceThread[] {
    if (!existsSync(this.threadStorePath)) {
      const seededThreads = createSeedThreads();
      this.persistThreadStore(seededThreads);
      return seededThreads;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.threadStorePath, "utf8")) as
        | PersistedThreadStore
        | LocalWorkspaceBootstrap;
      if (Array.isArray(parsed.threads)) {
        return parsed.threads.map((thread) => ({
          ...thread,
          messages: thread.messages.map((message: LocalThreadMessage) => ({
            ...message,
          })),
        }));
      }
    } catch {
      // Fall back to a fresh seeded thread list if the legacy file is malformed.
    }

    const seededThreads = createSeedThreads();
    this.persistThreadStore(seededThreads);
    return seededThreads;
  }

  private persistThreads(): void {
    this.persistThreadStore(this.toPublicThreads());
  }

  private persistThreadStore(threads: readonly LocalWorkspaceThread[]): void {
    mkdirSync(dirname(this.threadStorePath), { recursive: true });
    writeFileSync(
      this.threadStorePath,
      JSON.stringify({ threads }, null, 2),
      "utf8",
    );
  }

  private findThread(threadId: string): MutableLocalWorkspaceThread {
    const thread = this.threads.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!thread) {
      throw new Error(`Thread '${threadId}' was not found.`);
    }

    return thread;
  }

  private toPublicThreads(): LocalWorkspaceThread[] {
    return this.threads.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => ({ ...message })),
    }));
  }
}
