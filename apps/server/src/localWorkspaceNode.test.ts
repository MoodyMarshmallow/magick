import {
  resolveDefaultDocumentsDir,
  resolveLocalWorkspaceDir,
} from "../../../packages/shared/src/localWorkspaceNode";

describe("localWorkspaceNode windows support", () => {
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
});
