import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
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
  LocalWorkspaceCreatedDirectory,
  LocalWorkspaceCreatedFile,
  LocalWorkspaceDeletedEntry,
  LocalWorkspaceFilesBootstrap,
  LocalWorkspacePathChange,
  LocalWorkspaceRenamedDirectory,
  LocalWorkspaceRenamedFile,
  LocalWorkspaceThread,
} from "@magick/shared/localWorkspace";
import { getLocalWorkspaceFileTitle } from "../../../../packages/shared/src/localWorkspace";
import {
  createWorkspaceBootstrap,
  createWorkspaceFilesBootstrap,
} from "./localWorkspaceTree";

interface LocalWorkspaceServiceOptions {
  readonly workspaceDir: string;
}

const ignoredDirectoryNames = new Set([".git", ".magick", "node_modules"]);
const supportedFileExtensions = new Set([".md"]);
const legacyThreadStoreFileName = "workspace.json";

const toPosixPath = (filePath: string): string => filePath.split(sep).join("/");

const createThreadReply = (threadId: string): string =>
  `This reply stays in ${threadId}, which keeps the chat durable across local restarts.`;

export const pathsResolveToSameEntry = (
  currentPath: string,
  nextPath: string,
): boolean => {
  try {
    const currentStats = statSync(currentPath);
    const nextStats = statSync(nextPath);
    return (
      currentStats.dev === nextStats.dev && currentStats.ino === nextStats.ino
    );
  } catch {
    return false;
  }
};

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
    const workspaceEntries = this.listWorkspaceEntries();

    return createWorkspaceBootstrap({
      documents: workspaceEntries.documents,
      directories: workspaceEntries.directories,
      threads: this.toPublicThreads(),
      workspaceRoot: this.workspaceDir,
    });
  }

  public getFileWorkspaceBootstrap(): LocalWorkspaceFilesBootstrap {
    const workspaceEntries = this.listWorkspaceEntries();

    return createWorkspaceFilesBootstrap({
      documents: workspaceEntries.documents,
      directories: workspaceEntries.directories,
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
      title: getLocalWorkspaceFileTitle(filePath),
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

  public createFile(directoryPath: string): LocalWorkspaceCreatedFile {
    const absoluteDirectoryPath = this.resolveWorkspaceDirectory(
      directoryPath,
      {
        allowWorkspaceRoot: true,
      },
    );
    const fileName = this.resolveUniqueChildName(absoluteDirectoryPath, {
      baseName: "untitled",
      extension: ".md",
    });
    const absoluteFilePath = join(absoluteDirectoryPath, fileName);
    writeFileSync(absoluteFilePath, "", "utf8");

    return {
      filePath: this.toWorkspaceRelativePath(absoluteFilePath),
    };
  }

  public createDirectory(
    directoryPath: string,
  ): LocalWorkspaceCreatedDirectory {
    const absoluteDirectoryPath = this.resolveWorkspaceDirectory(
      directoryPath,
      {
        allowWorkspaceRoot: true,
      },
    );
    const directoryName = this.resolveUniqueChildName(absoluteDirectoryPath, {
      baseName: "untitled-folder",
      extension: "",
    });
    const absoluteChildDirectoryPath = join(
      absoluteDirectoryPath,
      directoryName,
    );
    mkdirSync(absoluteChildDirectoryPath, { recursive: true });

    return {
      path: this.toWorkspaceRelativePath(absoluteChildDirectoryPath),
    };
  }

  public renameFile(
    filePath: string,
    nextName: string,
  ): LocalWorkspaceRenamedFile {
    const absoluteFilePath = this.resolveWorkspaceFile(filePath);
    const sanitizedName = this.sanitizeEntryName(nextName, {
      fallbackBaseName: "untitled",
      extension: extname(filePath),
    });
    const resolvedName = this.resolveAvailableSiblingFileName(
      absoluteFilePath,
      sanitizedName,
    );
    const absoluteRenamedPath = this.resolveWorkspaceSiblingPath(
      absoluteFilePath,
      resolvedName,
    );

    if (absoluteRenamedPath !== absoluteFilePath) {
      renameSync(absoluteFilePath, absoluteRenamedPath);
    }

    return {
      previousFilePath: filePath,
      filePath: this.toWorkspaceRelativePath(absoluteRenamedPath),
    };
  }

  public renameDirectory(
    directoryPath: string,
    nextName: string,
  ): LocalWorkspaceRenamedDirectory {
    const absoluteDirectoryPath = this.resolveWorkspaceDirectory(directoryPath);
    const previousFilePaths = this.collectFilePathsInDirectory(
      absoluteDirectoryPath,
    );
    const sanitizedName = this.sanitizeEntryName(nextName, {
      fallbackBaseName: "untitled-folder",
      extension: "",
    });
    const absoluteRenamedPath = this.resolveWorkspaceSiblingPath(
      absoluteDirectoryPath,
      sanitizedName,
    );

    if (absoluteRenamedPath !== absoluteDirectoryPath) {
      renameSync(absoluteDirectoryPath, absoluteRenamedPath);
    }

    const filePathChanges = previousFilePaths.map(
      (previousFilePath) =>
        ({
          previousFilePath: this.toWorkspaceRelativePath(previousFilePath),
          filePath: this.toWorkspaceRelativePath(
            join(
              absoluteRenamedPath,
              relative(absoluteDirectoryPath, previousFilePath),
            ),
          ),
        }) satisfies LocalWorkspacePathChange,
    );

    return {
      previousPath: directoryPath,
      path: this.toWorkspaceRelativePath(absoluteRenamedPath),
      filePathChanges,
    };
  }

  public deleteFile(filePath: string): LocalWorkspaceDeletedEntry {
    const absoluteFilePath = this.resolveWorkspaceFile(filePath);
    rmSync(absoluteFilePath);

    return {
      deletedFilePaths: [filePath],
    };
  }

  public deleteDirectory(directoryPath: string): LocalWorkspaceDeletedEntry {
    const absoluteDirectoryPath = this.resolveWorkspaceDirectory(directoryPath);
    const deletedFilePaths = this.collectFilePathsInDirectory(
      absoluteDirectoryPath,
    ).map((filePath) => this.toWorkspaceRelativePath(filePath));
    rmSync(absoluteDirectoryPath, { force: true, recursive: true });

    return {
      deletedFilePaths,
    };
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

  private listWorkspaceEntries(): {
    readonly documents: readonly { readonly filePath: string }[];
    readonly directories: readonly { readonly directoryPath: string }[];
  } {
    const documents: { filePath: string }[] = [];
    const directories: { directoryPath: string }[] = [];
    const visitDirectory = (directoryPath: string) => {
      const entries = readdirSync(directoryPath, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      );

      for (const entry of entries) {
        const nextPath = join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          if (ignoredDirectoryNames.has(entry.name)) {
            continue;
          }

          directories.push({ directoryPath: nextPath });
          visitDirectory(nextPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        if (!supportedFileExtensions.has(extname(nextPath).toLowerCase())) {
          continue;
        }

        documents.push({
          filePath: nextPath,
        });
      }
    };

    visitDirectory(this.workspaceDir);
    return {
      documents,
      directories,
    };
  }

  private resolveWorkspaceFile(filePath: string): string {
    const absolutePath = this.resolveWorkspacePath(filePath);

    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`File '${filePath}' was not found.`);
    }

    return absolutePath;
  }

  private resolveWorkspaceDirectory(
    directoryPath: string,
    options: { readonly allowWorkspaceRoot?: boolean } = {},
  ): string {
    const absolutePath = this.resolveWorkspacePath(directoryPath, options);

    if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
      throw new Error(`Directory '${directoryPath}' was not found.`);
    }

    return absolutePath;
  }

  private resolveWorkspacePath(
    workspacePath: string,
    options: { readonly allowWorkspaceRoot?: boolean } = {},
  ): string {
    const normalizedPath = toPosixPath(workspacePath);
    const absolutePath = resolve(this.workspaceDir, normalizedPath);
    const relativeToRoot = relative(this.workspaceDir, absolutePath);
    const isWorkspaceRoot = relativeToRoot === "";

    if (
      relativeToRoot.startsWith("..") ||
      (isWorkspaceRoot && !options.allowWorkspaceRoot) ||
      toPosixPath(relativeToRoot) !== normalizedPath
    ) {
      throw new Error(`File '${workspacePath}' is outside the workspace root.`);
    }

    return absolutePath;
  }

  private toWorkspaceRelativePath(absolutePath: string): string {
    return toPosixPath(relative(this.workspaceDir, absolutePath));
  }

  private collectFilePathsInDirectory(directoryPath: string): string[] {
    const collectedPaths: string[] = [];
    const visit = (currentDirectoryPath: string) => {
      const entries = readdirSync(currentDirectoryPath, {
        withFileTypes: true,
      }).sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        const nextPath = join(currentDirectoryPath, entry.name);
        if (entry.isDirectory()) {
          if (ignoredDirectoryNames.has(entry.name)) {
            continue;
          }

          visit(nextPath);
          continue;
        }

        if (
          entry.isFile() &&
          supportedFileExtensions.has(extname(nextPath).toLowerCase())
        ) {
          collectedPaths.push(nextPath);
        }
      }
    };

    visit(directoryPath);
    return collectedPaths;
  }

  private sanitizeEntryName(
    nextName: string,
    args: {
      readonly fallbackBaseName: string;
      readonly extension: string;
    },
  ): string {
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      throw new Error("A name is required.");
    }

    const segments = trimmedName.split(/[\\/]+/).filter(Boolean);
    const leafName = segments.at(-1)?.trim() ?? "";
    if (!leafName || leafName === "." || leafName === "..") {
      throw new Error("A valid name is required.");
    }

    if (!args.extension) {
      return leafName;
    }

    const normalizedExtension = args.extension.toLowerCase();
    if (!supportedFileExtensions.has(normalizedExtension)) {
      throw new Error(`File extension '${args.extension}' is not supported.`);
    }

    if (leafName.toLowerCase().endsWith(normalizedExtension)) {
      return leafName;
    }

    return `${leafName || args.fallbackBaseName}${args.extension}`;
  }

  private resolveWorkspaceSiblingPath(
    absolutePath: string,
    nextName: string,
  ): string {
    const absoluteSiblingPath = join(dirname(absolutePath), nextName);
    const relativeSiblingPath =
      this.toWorkspaceRelativePath(absoluteSiblingPath);
    const resolvedSiblingPath = this.resolveWorkspacePath(relativeSiblingPath);
    if (
      resolvedSiblingPath !== absolutePath &&
      existsSync(resolvedSiblingPath) &&
      !pathsResolveToSameEntry(absolutePath, resolvedSiblingPath)
    ) {
      throw new Error(`Path '${relativeSiblingPath}' already exists.`);
    }

    return resolvedSiblingPath;
  }

  private resolveAvailableSiblingFileName(
    absoluteFilePath: string,
    nextName: string,
  ): string {
    const fileExtension = extname(nextName);
    const fileTitle = basename(nextName, fileExtension);
    const absoluteDirectoryPath = dirname(absoluteFilePath);
    const siblingEntries = readdirSync(absoluteDirectoryPath, {
      withFileTypes: true,
    });
    const siblingFileNames = new Set(
      siblingEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((entryName) => entryName !== basename(absoluteFilePath)),
    );

    let collisionIndex = 0;
    while (true) {
      const candidateName =
        collisionIndex === 0
          ? nextName
          : `${fileTitle} ${collisionIndex}${fileExtension}`;
      if (!siblingFileNames.has(candidateName)) {
        return candidateName;
      }

      collisionIndex += 1;
    }
  }

  private resolveUniqueChildName(
    absoluteDirectoryPath: string,
    args: {
      readonly baseName: string;
      readonly extension: string;
    },
  ): string {
    let suffix = 0;

    while (true) {
      const candidateName =
        suffix === 0
          ? `${args.baseName}${args.extension}`
          : `${args.baseName}-${suffix}${args.extension}`;
      const candidatePath = join(absoluteDirectoryPath, candidateName);
      if (!existsSync(candidatePath)) {
        return candidateName;
      }

      suffix += 1;
    }
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
