import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";

export interface ResolveLocalWorkspaceDirOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly readWindowsDocumentsDir?: (env: NodeJS.ProcessEnv) => string | null;
  readonly readMacDocumentsDir?: () => string | null;
}

interface ResolveDefaultDocumentsDirOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly readWindowsDocumentsDir?: (env: NodeJS.ProcessEnv) => string | null;
  readonly readMacDocumentsDir?: () => string | null;
}

const resolvePath = (platform: NodeJS.Platform) =>
  platform === "win32" ? win32.resolve : posix.resolve;

const resolveHomeDirectory = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string => {
  if (platform === "win32") {
    const userProfile = env.USERPROFILE?.trim();
    if (userProfile) {
      return userProfile;
    }

    const homeDrive = env.HOMEDRIVE?.trim() ?? "";
    const homePath = env.HOMEPATH?.trim() ?? "";
    const combinedHomePath = `${homeDrive}${homePath}`.trim();
    if (combinedHomePath) {
      return combinedHomePath;
    }
  }

  return env.HOME?.trim() || homedir();
};

const expandWindowsEnvironmentVariables = (
  pathValue: string,
  env: NodeJS.ProcessEnv,
): string => {
  return pathValue.replaceAll(/%([^%]+)%/g, (_match, variableName: string) => {
    return env[variableName]?.trim() || `%${variableName}%`;
  });
};

const readWindowsDocumentsDirFromRegistry = (
  env: NodeJS.ProcessEnv,
): string | null => {
  try {
    const output = execFileSync(
      "reg",
      [
        "query",
        String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`,
        "/v",
        "Personal",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const match = output.match(/^\s*Personal\s+REG_\w+\s+(.+)$/m);
    if (!match?.[1]) {
      return null;
    }

    return expandWindowsEnvironmentVariables(match[1].trim(), env);
  } catch {
    return null;
  }
};

const resolveWindowsDocumentsDir = (
  env: NodeJS.ProcessEnv,
  readWindowsDocumentsDir: (env: NodeJS.ProcessEnv) => string | null,
): string => {
  return (
    readWindowsDocumentsDir(env) ||
    resolvePath("win32")(resolveHomeDirectory(env, "win32"), "Documents")
  );
};

const readMacDocumentsDirFromSystem = (): string | null => {
  try {
    const output = execFileSync(
      "osascript",
      ["-e", "POSIX path of (path to documents folder)"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    return output || null;
  } catch {
    return null;
  }
};

const resolveMacDocumentsDir = (
  env: NodeJS.ProcessEnv,
  readMacDocumentsDir: () => string | null,
): string => {
  return (
    readMacDocumentsDir() ||
    resolvePath("darwin")(resolveHomeDirectory(env, "darwin"), "Documents")
  );
};

const resolveXdgDocumentsDir = (env: NodeJS.ProcessEnv): string | null => {
  const configuredDocumentsDir = env.XDG_DOCUMENTS_DIR?.trim();
  if (configuredDocumentsDir) {
    return configuredDocumentsDir.replaceAll(
      "$HOME",
      resolveHomeDirectory(env, "linux"),
    );
  }

  const userDirsConfigPath = resolve(
    env.XDG_CONFIG_HOME?.trim() ||
      resolve(resolveHomeDirectory(env, "linux"), ".config"),
    "user-dirs.dirs",
  );
  if (!existsSync(userDirsConfigPath)) {
    return null;
  }

  try {
    const userDirsConfig = readFileSync(userDirsConfigPath, "utf8");
    const documentsDirMatch = userDirsConfig.match(
      /^XDG_DOCUMENTS_DIR=(?:"([^"]+)"|'([^']+)')$/m,
    );
    const configuredPath = documentsDirMatch?.[1] ?? documentsDirMatch?.[2];
    if (!configuredPath) {
      return null;
    }

    return configuredPath.replaceAll(
      "$HOME",
      resolveHomeDirectory(env, "linux"),
    );
  } catch {
    return null;
  }
};

export const resolveDefaultDocumentsDir = (
  options: ResolveDefaultDocumentsDirOptions = {},
): string => {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (platform === "win32") {
    return resolveWindowsDocumentsDir(
      env,
      options.readWindowsDocumentsDir ?? readWindowsDocumentsDirFromRegistry,
    );
  }

  if (platform === "darwin") {
    return resolveMacDocumentsDir(
      env,
      options.readMacDocumentsDir ?? readMacDocumentsDirFromSystem,
    );
  }

  return (
    resolveXdgDocumentsDir(env) ??
    resolvePath(platform)(resolveHomeDirectory(env, platform), "Documents")
  );
};

export const resolveLocalWorkspaceDir = (
  options: ResolveLocalWorkspaceDirOptions = {},
): string => {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const defaultDocumentsDirOptions: ResolveDefaultDocumentsDirOptions =
    options.readWindowsDocumentsDir || options.readMacDocumentsDir
      ? {
          env,
          platform,
          ...(options.readWindowsDocumentsDir
            ? { readWindowsDocumentsDir: options.readWindowsDocumentsDir }
            : {}),
          ...(options.readMacDocumentsDir
            ? { readMacDocumentsDir: options.readMacDocumentsDir }
            : {}),
        }
      : {
          env,
          platform,
        };

  return (
    env.MAGICK_WORKSPACE_ROOT?.trim() ||
    env.MAGICK_WORKSPACE_DIR?.trim() ||
    env.MAGICK_WEB_WORKSPACE_DIR?.trim() ||
    resolvePath(platform)(
      resolveDefaultDocumentsDir(defaultDocumentsDirOptions),
      "magick",
    )
  );
};
