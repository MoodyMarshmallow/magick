import { execFileSync, spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const devPorts = [4173, 8787];
const workspaceRoot = realpathSync(
  resolve(fileURLToPath(new URL("..", import.meta.url))),
);
const magickProcessMatchersByPort = {
  4173: ["apps/web", "vite"],
  8787: ["apps/server", "src/main.ts"],
};

const delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const parseListeningPids = (port) => {
  try {
    const output = execFileSync("ss", ["-ltnpH"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const matchingLines = output
      .split("\n")
      .filter((line) => new RegExp(`:${port}(\\s|$)`).test(line));
    const pids = new Set();

    for (const line of matchingLines) {
      for (const match of line.matchAll(/pid=(\d+)/g)) {
        const pid = Number.parseInt(match[1], 10);
        if (!Number.isNaN(pid) && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }

    return [...pids];
  } catch {
    return [];
  }
};

const readProcessCommand = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    return null;
  }
};

const readProcessCwd = (pid) => {
  try {
    return realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
};

const isMagickDevProcess = (port, pid) => {
  const processCwd = readProcessCwd(pid);
  if (processCwd == null || processCwd !== workspaceRoot) {
    return false;
  }

  const processCommand = readProcessCommand(pid);
  if (processCommand == null) {
    return false;
  }

  return magickProcessMatchersByPort[port].some((matcher) =>
    processCommand.includes(matcher),
  );
};

const stopProcessOnPort = async (port) => {
  const pids = parseListeningPids(port).filter((pid) =>
    isMagickDevProcess(port, pid),
  );
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    process.kill(pid, "SIGTERM");
  }

  await delay(750);

  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      process.kill(pid, "SIGKILL");
    }
  }
};

const main = async () => {
  for (const port of devPorts) {
    await stopProcessOnPort(port);
  }

  const child = spawn("bun", ["run", "dev:stack"], {
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
};

await main();
