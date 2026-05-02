import { createServer } from "node:http";
import { setCodexTransportDebugEnabled } from "./ai/agent/modules/provider-runtime/codex/codexResponsesClient";
import { attachWebSocketServer, createBackendServices } from "./index";

export const AGENT_TRANSPORT_DEBUG_FLAG = "--debug-agent-transport";

export const resolveBackendBinding = (env: NodeJS.ProcessEnv = process.env) => {
  const host = env.MAGICK_BACKEND_HOST?.trim() || "127.0.0.1";
  const rawPort = env.MAGICK_BACKEND_PORT?.trim();
  const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : 8787;

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(
      `Invalid MAGICK_BACKEND_PORT '${rawPort ?? ""}'. Expected an integer between 1 and 65535.`,
    );
  }

  return {
    host,
    port: parsedPort,
  } as const;
};

export const resolveBackendRuntimeOptions = (
  argv: readonly string[] = process.argv.slice(2),
) => {
  return {
    debugAgentTransport: argv.includes(AGENT_TRANSPORT_DEBUG_FLAG),
  } as const;
};

export const applyBackendRuntimeOptions = (
  runtimeOptions: ReturnType<typeof resolveBackendRuntimeOptions>,
): void => {
  setCodexTransportDebugEnabled(runtimeOptions.debugAgentTransport);
};

export const startBackendServer = async (
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) => {
  const runtimeOptions = resolveBackendRuntimeOptions(argv);
  applyBackendRuntimeOptions(runtimeOptions);

  const services = createBackendServices();
  const server = createServer();
  attachWebSocketServer(server, services);

  const binding = resolveBackendBinding(env);
  await new Promise<void>((resolve, reject) => {
    server.listen(binding.port, binding.host, () => resolve());
    server.once("error", reject);
  });

  return {
    binding,
    runtimeOptions,
    server,
  } as const;
};

const run = async () => {
  const { binding, runtimeOptions, server } = await startBackendServer();
  process.stdout.write(
    `Magick backend listening on ws://${binding.host}:${binding.port}\n`,
  );
  if (runtimeOptions.debugAgentTransport) {
    process.stdout.write("Agent transport debug logging enabled\n");
  }

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

if (import.meta.main) {
  void run().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  });
}
