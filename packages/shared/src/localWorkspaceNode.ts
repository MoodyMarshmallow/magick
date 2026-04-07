import { join } from "node:path";

export interface ResolveLocalWorkspaceDirOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export const resolveLocalWorkspaceDir = (
  options: ResolveLocalWorkspaceDirOptions = {},
): string => {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  return (
    env.MAGICK_WORKSPACE_ROOT?.trim() ||
    env.MAGICK_WORKSPACE_DIR?.trim() ||
    env.MAGICK_WEB_WORKSPACE_DIR?.trim() ||
    join(cwd, ".magick", "workspace")
  );
};
