import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveDefaultDocumentsDir,
  resolveLocalWorkspaceDir,
} from "./localWorkspaceNode";

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

  it("falls back to the Documents/magick workspace directory in the user's home", () => {
    expect(
      resolveLocalWorkspaceDir({
        cwd: "/repo",
        env: {
          HOME: "/Users/tester",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("/Users/tester/Documents/magick");
  });

  it("uses the Windows documents directory from the registry when available", () => {
    expect(
      resolveLocalWorkspaceDir({
        env: {
          USERPROFILE: String.raw`C:\Users\tester`,
          OneDrive: String.raw`C:\Users\tester\OneDrive`,
        } as NodeJS.ProcessEnv,
        platform: "win32",
        readWindowsDocumentsDir: (env) =>
          env.OneDrive ? String.raw`${env.OneDrive}\Documents` : null,
      }),
    ).toBe(String.raw`C:\Users\tester\OneDrive\Documents\magick`);
  });

  it("falls back to USERPROFILE Documents on Windows", () => {
    expect(
      resolveDefaultDocumentsDir({
        env: {
          USERPROFILE: String.raw`C:\Users\tester`,
        } as NodeJS.ProcessEnv,
        platform: "win32",
        readWindowsDocumentsDir: () => null,
      }),
    ).toBe(String.raw`C:\Users\tester\Documents`);
  });

  it("uses the macOS documents directory from the system when available", () => {
    expect(
      resolveLocalWorkspaceDir({
        env: {
          HOME: "/Users/tester",
        } as NodeJS.ProcessEnv,
        platform: "darwin",
        readMacDocumentsDir: () =>
          "/Users/tester/Library/Mobile Documents/com~apple~CloudDocs/Documents",
      }),
    ).toBe(
      "/Users/tester/Library/Mobile Documents/com~apple~CloudDocs/Documents/magick",
    );
  });

  it("falls back to HOME Documents on macOS", () => {
    expect(
      resolveDefaultDocumentsDir({
        env: {
          HOME: "/Users/tester",
        } as NodeJS.ProcessEnv,
        platform: "darwin",
        readMacDocumentsDir: () => null,
      }),
    ).toBe("/Users/tester/Documents");
  });

  it("uses XDG_DOCUMENTS_DIR when it is configured", () => {
    expect(
      resolveLocalWorkspaceDir({
        env: {
          HOME: "/home/tester",
          XDG_DOCUMENTS_DIR: "$HOME/Docs",
        } as NodeJS.ProcessEnv,
      }),
    ).toBe("/home/tester/Docs/magick");
  });

  it("uses the XDG user dirs config when present", () => {
    const configRoot = mkdtempSync(join(tmpdir(), "magick-xdg-config-"));

    try {
      writeFileSync(
        join(configRoot, "user-dirs.dirs"),
        'XDG_DOCUMENTS_DIR="$HOME/Localized Documents"\n',
        "utf8",
      );

      expect(
        resolveDefaultDocumentsDir({
          env: {
            HOME: "/home/tester",
            XDG_CONFIG_HOME: configRoot,
          } as NodeJS.ProcessEnv,
        }),
      ).toBe("/home/tester/Localized Documents");
    } finally {
      rmSync(configRoot, { recursive: true, force: true });
    }
  });
});
