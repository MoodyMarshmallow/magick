import { editorJsonToMarkdown, markdownToEditorHtml } from "./commentAnchors";

describe("commentAnchors", () => {
  it("renders markdown paragraphs into editor html", () => {
    const html = markdownToEditorHtml(
      ["Intro paragraph.", "Tail paragraph."].join("\n\n"),
    );

    expect(html).toBe("<p>Intro paragraph.</p><p>Tail paragraph.</p>");
  });

  it("renders hard breaks inside a paragraph", () => {
    const html = markdownToEditorHtml("first line\nsecond line");

    expect(html).toBe("<p>first line<br />second line</p>");
  });

  it("escapes html while rendering to editor html", () => {
    const html = markdownToEditorHtml("<b>safe</b>\n<script>alert(1)</script>");

    expect(html).toContain("&lt;b&gt;safe&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("serializes editor json back to markdown paragraphs", () => {
    const markdown = editorJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "plain text" }],
        },
      ],
    });

    expect(markdown).toBe("plain text");
  });

  it("serializes mixed text across paragraphs", () => {
    const markdown = editorJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before and after" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    });

    expect(markdown).toBe("Before and after\n\nSecond paragraph");
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
