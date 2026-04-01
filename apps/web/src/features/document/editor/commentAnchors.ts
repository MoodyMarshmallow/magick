const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

export const markdownToEditorHtml = (markdown: string): string => {
  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const content = escapeHtml(paragraph).replaceAll("\n", "<br />");
      return `<p>${content || "<br />"}</p>`;
    })
    .join("");
};

interface JsonNode {
  readonly type: string;
  readonly text?: string;
  readonly content?: readonly JsonNode[] | undefined;
}

const serializeNode = (node: JsonNode): string => {
  if (node.type === "text") {
    return node.text ?? "";
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  const children = node.content?.map(serializeNode).join("") ?? "";

  if (node.type === "paragraph") {
    return children.trimEnd();
  }

  return children;
};

export const editorJsonToMarkdown = (document: JsonNode): string => {
  return (
    document.content
      ?.filter((node) => node.type === "paragraph")
      .map(serializeNode)
      .join("\n\n") ?? ""
  ).trim();
};
