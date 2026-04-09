import type { ResolvedPos } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import type {
  EditorFormatState,
  EditorHeadingLevel,
  EditorSelectionState,
} from "./editorTypes";

const headingLevels = [1, 2, 3, 4, 5, 6] as const;

const getAncestorNode = ($from: ResolvedPos, typeName: string) => {
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === typeName) {
      return node;
    }
  }

  return null;
};

const hasAncestorNode = ($from: ResolvedPos, typeName: string): boolean => {
  return getAncestorNode($from, typeName) !== null;
};

const getTextBlock = ($from: ResolvedPos) => {
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      return node;
    }
  }

  return null;
};

const isMarkActive = (view: EditorView, markName: string): boolean => {
  const markType = view.state.schema.marks[markName];
  if (!markType) {
    return false;
  }

  const {
    selection: { empty, from, to, $from },
    storedMarks,
    doc,
  } = view.state;

  if (empty) {
    const marks = storedMarks ?? $from.marks();
    return markType.isInSet(marks) != null;
  }

  return doc.rangeHasMark(from, to, markType);
};

export const getEditorFormatState = (view: EditorView): EditorFormatState => {
  const { $from } = view.state.selection;
  const textBlock = getTextBlock($from);
  const headingNode = getAncestorNode($from, "heading");
  const headingLevel = headingNode?.attrs.level;

  return {
    paragraph: textBlock?.type.name === "paragraph",
    headingLevel: headingLevels.includes(headingLevel)
      ? (headingLevel as EditorHeadingLevel)
      : null,
    bulletList: hasAncestorNode($from, "bullet_list"),
    orderedList: hasAncestorNode($from, "ordered_list"),
    blockquote: hasAncestorNode($from, "blockquote"),
    bold: isMarkActive(view, "strong"),
    italic: isMarkActive(view, "emphasis"),
    strike: isMarkActive(view, "strike_through"),
    code: isMarkActive(view, "inlineCode"),
  };
};

export const getEditorSelectionState = (
  view: EditorView,
): EditorSelectionState | null => {
  const { empty, from, to } = view.state.selection;
  if (empty) {
    return null;
  }

  const text = view.state.doc.textBetween(from, to, " ").trim();
  return text ? { text } : null;
};
