import {
  createFileDiffPreview,
  formatFileDiffPreview,
} from "./fileDiffPreview";

describe("fileDiffPreview", () => {
  it("builds a created-file diff preview", () => {
    const diff = createFileDiffPreview({
      path: "notes/new.md",
      previousContent: null,
      nextContent: "first line\nsecond line",
    });

    expect(diff.kind).toBe("created");
    expect(diff.hunks[0]?.lines).toEqual(["+first line", "+second line"]);
  });

  it("formats an updated-file diff preview", () => {
    const diff = createFileDiffPreview({
      path: "notes/example.md",
      previousContent: "hello\nworld",
      nextContent: "hello\nmagick",
    });

    expect(formatFileDiffPreview(diff)).toContain("-world");
    expect(formatFileDiffPreview(diff)).toContain("+magick");
  });
});
