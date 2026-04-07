import { join } from "node:path";
import { resolveLocalWorkspaceDir } from "./localWorkspaceNode";

describe("resolveLocalWorkspaceDir", () => {
  it("prefers explicit workspace env vars", () => {
    expect(
      resolveLocalWorkspaceDir({
        cwd: "/repo",
        env: {
          MAGICK_WORKSPACE_ROOT: "/tmp/root",
          MAGICK_WORKSPACE_DIR: "/tmp/dir",
          MAGICK_WEB_WORKSPACE_DIR: "/tmp/web",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("/tmp/root");
  });

  it("falls back to the default .magick workspace directory", () => {
    expect(
      resolveLocalWorkspaceDir({ cwd: "/repo", env: {} as NodeJS.ProcessEnv }),
    ).toBe(join("/repo", ".magick", "workspace"));
  });
});
