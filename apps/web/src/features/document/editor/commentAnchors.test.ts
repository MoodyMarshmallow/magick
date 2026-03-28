import {
  editorJsonToMarkdown,
  markdownToEditorHtml,
  parseMarkdownWithCommentAnchors,
} from "./commentAnchors";

describe("commentAnchors", () => {
  it("parses paired comment anchor directives", () => {
    const parsed = parseMarkdownWithCommentAnchors(
      "Before ::comment-start[thread_1]{}anchored text::comment-end[thread_1]{} after",
    );

    expect(parsed.paragraphs[0]).toEqual([
      "Before ",
      { threadId: "thread_1", text: "anchored text" },
      " after",
    ]);
  });

  it("parses multiple paragraphs and preserves plain text sections", () => {
    const parsed = parseMarkdownWithCommentAnchors(
      [
        "Intro paragraph.",
        "::comment-start[thread_1]{}Anchored text::comment-end[thread_1]{}",
        "Tail paragraph.",
      ].join("\n\n"),
    );

    expect(parsed.paragraphs).toEqual([
      ["Intro paragraph."],
      [{ threadId: "thread_1", text: "Anchored text" }],
      ["Tail paragraph."],
    ]);
  });

  it("parses multiple anchors inside the same paragraph", () => {
    const parsed = parseMarkdownWithCommentAnchors(
      "Before ::comment-start[thread_1]{}one::comment-end[thread_1]{} middle ::comment-start[thread_2]{}two::comment-end[thread_2]{} after",
    );

    expect(parsed.paragraphs[0]).toEqual([
      "Before ",
      { threadId: "thread_1", text: "one" },
      " middle ",
      { threadId: "thread_2", text: "two" },
      " after",
    ]);
  });

  it("throws when an anchor is missing its closing pair", () => {
    expect(() =>
      parseMarkdownWithCommentAnchors(
        "::comment-start[thread_1]{}broken anchor",
      ),
    ).toThrow("Missing closing anchor for 'thread_1'.");
  });

  it("renders anchor spans into editor html", () => {
    const html = markdownToEditorHtml(
      "::comment-start[thread_1]{}anchored text::comment-end[thread_1]{} ",
    );

    expect(html).toContain('data-comment-thread="thread_1"');
    expect(html).toContain("anchored text");
  });

  it("escapes html while rendering to editor html", () => {
    const html = markdownToEditorHtml(
      "<b>safe</b> ::comment-start[thread_1]{}<script>alert(1)</script>::comment-end[thread_1]{}",
    );

    expect(html).toContain("&lt;b&gt;safe&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("serializes editor json back to markdown directives", () => {
    const markdown = editorJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "anchored",
              marks: [
                {
                  type: "commentAnchor",
                  attrs: { threadId: "thread_1" },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(markdown).toBe(
      "::comment-start[thread_1]{}anchored::comment-end[thread_1]{}",
    );
  });

  it("serializes mixed marked and unmarked text across paragraphs", () => {
    const markdown = editorJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            {
              type: "text",
              text: "anchored",
              marks: [
                {
                  type: "commentAnchor",
                  attrs: { threadId: "thread_1" },
                },
              ],
            },
            { type: "text", text: " after" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    });

    expect(markdown).toBe(
      "Before ::comment-start[thread_1]{}anchored::comment-end[thread_1]{} after\n\nSecond paragraph",
    );
  });

  it("preserves hard breaks when serializing plain text", () => {
    const markdown = editorJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "first line" },
            { type: "hardBreak" },
            { type: "text", text: "second line" },
          ],
        },
      ],
    });

    expect(markdown).toBe("first line\nsecond line");
  });
});
