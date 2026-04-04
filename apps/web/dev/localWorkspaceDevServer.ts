import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LocalWorkspaceFileEvent } from "@magick/shared/localWorkspace";
import type { Connect, Plugin } from "vite";
import { LocalWorkspaceService } from "../../desktop/src/main/localWorkspaceService";
import { LocalWorkspaceWatcher } from "../../desktop/src/main/localWorkspaceWatcher";

const supportedFileExtensions = new Set([".md", ".mdx", ".txt"]);

const seedFiles = [
  {
    filePath: "notes/studio/evergreen-systems-memo.md",
    markdown:
      "Magick should feel like a calm studio for thinking with AI.\n\nThe best interfaces keep momentum without hiding system state.\n\nUse shared contracts to keep streaming and replay predictable.",
  },
  {
    filePath: "notes/studio/systems-garden-note.md",
    markdown:
      "Keep duplicate document views synchronized from one shared draft state.\n\nSplits should feel like moving paper around a desk, not launching a new mode.",
  },
  {
    filePath: "notes/research/layout-observations.md",
    markdown:
      "We should evaluate split affordances by how confidently a user can predict the resulting layout before they release the pointer.\n\nThis file exists so web:dev has a real nested local file to open.",
  },
  {
    filePath: "notes/archive/recovery-notes.txt",
    markdown:
      "A local-first client earns trust when restart and replay paths feel boring instead of magical.",
  },
] as const;

const hasSupportedWorkspaceFiles = (workspaceDir: string): boolean => {
  const visit = (directoryPath: string): boolean => {
    const entries = readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (visit(nextPath)) {
          return true;
        }
        continue;
      }

      if (entry.isFile()) {
        const extension = entry.name
          .slice(entry.name.lastIndexOf("."))
          .toLowerCase();
        if (supportedFileExtensions.has(extension)) {
          return true;
        }
      }
    }

    return false;
  };

  return visit(workspaceDir);
};

export const ensureSeedWorkspaceFiles = (workspaceDir: string): void => {
  mkdirSync(workspaceDir, { recursive: true });
  if (hasSupportedWorkspaceFiles(workspaceDir)) {
    return;
  }

  for (const seedFile of seedFiles) {
    const absoluteFilePath = join(workspaceDir, seedFile.filePath);
    mkdirSync(dirname(absoluteFilePath), { recursive: true });
    writeFileSync(absoluteFilePath, seedFile.markdown, "utf8");
  }
};

const readRequestBody = async (
  request: Parameters<Connect.NextHandleFunction>[0],
): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (
  response: Parameters<Connect.NextHandleFunction>[1],
  statusCode: number,
  payload: unknown,
) => {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
};

const sendWorkspaceEvent = (
  response: Parameters<Connect.NextHandleFunction>[1],
  event: LocalWorkspaceFileEvent,
) => {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
};

interface LocalWorkspaceDevPluginOptions {
  readonly workspaceDir?: string;
  readonly createWorkspaceService?: (
    workspaceDir: string,
  ) => LocalWorkspaceService;
  readonly createWatcher?: (args: {
    workspaceDir: string;
    onEvent: (event: LocalWorkspaceFileEvent) => void;
  }) => { start: () => void; stop: () => void };
}

export const createLocalWorkspaceDevPlugin = (
  options: LocalWorkspaceDevPluginOptions = {},
): Plugin => {
  return {
    name: "magick-local-workspace-dev-server",
    configureServer(server) {
      const workspaceDir =
        options.workspaceDir ??
        process.env.MAGICK_WEB_WORKSPACE_DIR ??
        join(process.cwd(), ".magick", "workspace");

      ensureSeedWorkspaceFiles(workspaceDir);
      const workspaceService =
        options.createWorkspaceService?.(workspaceDir) ??
        new LocalWorkspaceService({ workspaceDir });
      const workspaceEventClients = new Set<
        Parameters<Connect.NextHandleFunction>[1]
      >();
      const workspaceWatcher =
        options.createWatcher?.({
          workspaceDir,
          onEvent: (event) => {
            for (const client of workspaceEventClients) {
              sendWorkspaceEvent(client, event);
            }
          },
        }) ??
        new LocalWorkspaceWatcher({
          workspaceDir,
          onEvent: (event) => {
            for (const client of workspaceEventClients) {
              sendWorkspaceEvent(client, event);
            }
          },
        });

      workspaceWatcher.start();
      server.httpServer?.once("close", () => {
        workspaceWatcher.stop();
      });

      server.middlewares.use(
        "/api/local-workspace",
        async (request, response, next) => {
          try {
            const requestUrl = new URL(request.url ?? "/", "http://localhost");

            if (request.method === "GET" && requestUrl.pathname === "/events") {
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/event-stream");
              response.setHeader("Cache-Control", "no-cache, no-transform");
              response.setHeader("Connection", "keep-alive");
              response.write("retry: 1000\n\n");
              workspaceEventClients.add(response);
              request.on("close", () => {
                workspaceEventClients.delete(response);
              });
              return;
            }

            if (
              request.method === "GET" &&
              requestUrl.pathname === "/bootstrap"
            ) {
              return sendJson(
                response,
                200,
                workspaceService.getFileWorkspaceBootstrap(),
              );
            }

            if (requestUrl.pathname === "/file") {
              const filePath = requestUrl.searchParams.get("path");
              if (!filePath) {
                return sendJson(response, 400, {
                  code: "missing_file_path",
                  message: "The local workspace file path is required.",
                });
              }

              if (request.method === "GET") {
                return sendJson(
                  response,
                  200,
                  workspaceService.openFile(filePath),
                );
              }

              if (request.method === "PUT") {
                const markdown = await readRequestBody(request);
                workspaceService.saveFile(filePath, markdown);
                return sendJson(response, 200, { ok: true });
              }
            }

            next();
          } catch (error) {
            sendJson(response, 500, {
              code: "local_workspace_request_failed",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    },
  };
};
