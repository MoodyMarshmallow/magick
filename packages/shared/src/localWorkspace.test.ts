import {
  getLocalWorkspaceFileExtension,
  getLocalWorkspaceFileTitle,
} from "./localWorkspace";

describe("localWorkspace helpers", () => {
  it("derives the visible title from the filename stem", () => {
    expect(getLocalWorkspaceFileTitle("notes/example.md")).toBe("example");
    expect(getLocalWorkspaceFileTitle("notes/archive/recovery-notes.txt")).toBe(
      "recovery-notes",
    );
  });

  it("returns an empty extension for extensionless paths", () => {
    expect(getLocalWorkspaceFileExtension("notes/README")).toBe("");
  });
});
