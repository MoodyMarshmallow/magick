export interface AnchorSpan {
  readonly threadId: string;
  readonly text: string;
}

export interface ParsedMarkdownDocument {
  readonly paragraphs: readonly (string | AnchorSpan)[][];
}

const startPattern = /^::comment-start\[([^\]]+)\]\{\}/;
const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

export const parseMarkdownWithCommentAnchors = (
  markdown: string,
): ParsedMarkdownDocument => {
  const paragraphs = markdown.split(/\n\s*\n/).map((paragraph) => {
    const nodes: (string | AnchorSpan)[] = [];
    let cursor = 0;

    while (cursor < paragraph.length) {
      const remaining = paragraph.slice(cursor);
      const startMatch = remaining.match(startPattern);
      if (startMatch && startMatch.index === 0) {
        const threadId = startMatch[1];
        if (!threadId) {
          throw new Error("Comment anchor is missing its thread id.");
        }
        const afterStart = cursor + startMatch[0].length;
        const closingToken = `::comment-end[${threadId}]{}`;
        const closingIndex = paragraph.indexOf(closingToken, afterStart);

        const alternateClosingToken = `::comment-end[${threadId}]{} `;
        const alternateClosingIndex = paragraph.indexOf(
          alternateClosingToken,
          afterStart,
        );
        const resolvedClosingIndex =
          closingIndex === -1 ||
          (alternateClosingIndex !== -1 && alternateClosingIndex < closingIndex)
            ? alternateClosingIndex
            : closingIndex;

        if (resolvedClosingIndex === -1) {
          throw new Error(`Missing closing anchor for '${threadId}'.`);
        }

        const anchoredText = paragraph.slice(afterStart, resolvedClosingIndex);
        nodes.push({ threadId, text: anchoredText });
        cursor = resolvedClosingIndex + closingToken.length;
        continue;
      }

      const nextAnchorIndex = remaining.indexOf("::comment-start[");
      if (nextAnchorIndex === -1) {
        nodes.push(remaining);
        break;
      }

      nodes.push(remaining.slice(0, nextAnchorIndex));
      cursor += nextAnchorIndex;
    }

    return nodes;
  });

  return { paragraphs };
};

export const markdownToEditorHtml = (markdown: string): string => {
  const parsed = parseMarkdownWithCommentAnchors(markdown);
  return parsed.paragraphs
    .map((paragraph) => {
      const content = paragraph
        .map((node) => {
          if (typeof node === "string") {
            return escapeHtml(node);
          }

          return `<span data-comment-thread="${node.threadId}">${escapeHtml(node.text)}</span>`;
        })
        .join("");
      return `<p>${content || "<br />"}</p>`;
    })
    .join("");
};

interface JsonNode {
  readonly type: string;
  readonly text?: string;
  readonly attrs?:
    | {
        readonly threadId?: string;
      }
    | undefined;
  readonly marks?: readonly {
    readonly type: string;
    readonly attrs?:
      | {
          readonly threadId?: string;
        }
      | undefined;
  }[];
  readonly content?: readonly JsonNode[] | undefined;
}

const serializeNode = (node: JsonNode): string => {
  if (node.type === "text") {
    const text = node.text ?? "";
    const commentMark = node.marks?.find(
      (mark) => mark.type === "commentAnchor",
    );
    const threadId = commentMark?.attrs?.threadId;
    if (!threadId) {
      return text;
    }

    return `::comment-start[${threadId}]{}${text}::comment-end[${threadId}]{}`;
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
