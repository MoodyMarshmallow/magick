import {
  PathPresentationError,
  PathPresentationPolicy,
} from "./pathPresentationPolicy";

describe("PathPresentationPolicy", () => {
  it("converts absolute paths into workspace-relative agent paths", () => {
    const policy = new PathPresentationPolicy("workspace-relative");

    expect(
      policy.toAgentPath("/workspace", "/workspace/notes/example.md"),
    ).toBe("notes/example.md");
  });

  it("rejects absolute agent paths in workspace-relative mode", () => {
    const policy = new PathPresentationPolicy("workspace-relative");

    expect(() => policy.fromAgentPath("/workspace/notes/example.md")).toThrow(
      PathPresentationError,
    );
  });

  it("passes paths through in absolute mode", () => {
    const policy = new PathPresentationPolicy("absolute");

    expect(policy.fromAgentPath("/workspace/notes/example.md")).toBe(
      "/workspace/notes/example.md",
    );
  });

  it("treats dot paths as the workspace root in relative mode", () => {
    const policy = new PathPresentationPolicy("workspace-relative");

    expect(policy.fromAgentPath(".")).toBe("");
    expect(policy.fromAgentPath("./")).toBe("");
  });
});
