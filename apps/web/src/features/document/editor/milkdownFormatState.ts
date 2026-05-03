import type { ResolvedPos } from "@milkdown/prose/model";
import type { Selection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type {
  EditorFormatState,
  EditorHeadingLevel,
  EditorSelectionState,
} from "./editorTypes";

const headingLevels = [1, 2, 3, 4, 5, 6] as const;

const inactiveEditorFormatState: EditorFormatState = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  headingLevel: null,
  italic: false,
  orderedList: false,
  paragraph: false,
  strike: false,
};

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

const isMarkActive = (
  view: EditorView,
  markName: string,
  selection?: Selection,
): boolean => {
  const state = view.state as EditorView["state"] | undefined;
  const markType = state?.schema.marks[markName];
  if (!markType) {
    return false;
  }

  const { storedMarks, doc } = state;
  const activeSelection = selection ?? state.selection;
  const { empty, from, to, $from } = activeSelection;

  if (empty) {
    const marks = storedMarks ?? $from.marks();
    return markType.isInSet(marks) != null;
  }

  return doc.rangeHasMark(from, to, markType);
};

export const getEditorFormatState = (
  view: EditorView,
  selection?: Selection,
): EditorFormatState => {
  const state = view.state as EditorView["state"] | undefined;
  const activeSelection = selection ?? state?.selection;
  if (!state?.schema || !activeSelection?.$from) {
    return inactiveEditorFormatState;
  }

  const { $from } = activeSelection;
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
    bold: isMarkActive(view, "strong", activeSelection),
    italic: isMarkActive(view, "emphasis", activeSelection),
    strike: isMarkActive(view, "strike_through", activeSelection),
    code: isMarkActive(view, "inlineCode", activeSelection),
  };
};

export const getEditorSelectionState = (
  view: EditorView,
  selection?: Selection,
): EditorSelectionState | null => {
  const state = view.state as EditorView["state"] | undefined;
  const activeSelection = selection ?? state?.selection;
  if (!state?.doc || !activeSelection) {
    return null;
  }

  const { empty, from, to } = activeSelection;
  if (empty) {
    return null;
  }

  const text = state.doc.textBetween(from, to, " ").trim();
  return text ? { text } : null;
};
