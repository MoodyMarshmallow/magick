import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { CommentAnchorExtension } from "../editor/commentAnchorExtension";
import {
  editorJsonToMarkdown,
  markdownToEditorHtml,
} from "../editor/commentAnchors";

export interface EditorSelectionState {
  readonly text: string;
  readonly threadId: string | null;
}

export interface EditorSurfaceHandle {
  applyThreadToSelection: (threadId: string) => string | null;
  focusThread: (threadId: string) => void;
}

interface EditorSurfaceProps {
  readonly markdown: string;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onSelectionChange: (selection: EditorSelectionState | null) => void;
  readonly onThreadClick: (threadId: string) => void;
}

const getThreadIdFromSelection = (
  editor: NonNullable<ReturnType<typeof useEditor>>,
) => {
  const { from, to, empty } = editor.state.selection;
  if (empty) {
    return null;
  }

  const type = editor.schema.marks.commentAnchor;
  if (!type) {
    return null;
  }

  let detected: string | null = null;
  editor.state.doc.nodesBetween(from, to, (node) => {
    const mark = node.marks.find((candidate) => candidate.type === type);
    const threadId = mark?.attrs.threadId as string | null | undefined;
    if (threadId) {
      detected = threadId;
      return false;
    }

    return undefined;
  });

  return detected;
};

export const EditorSurface = forwardRef<
  EditorSurfaceHandle,
  EditorSurfaceProps
>(function EditorSurface(
  { markdown, onMarkdownChange, onSelectionChange, onThreadClick },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedMarkdownRef = useRef(markdown);
  const editor = useEditor({
    extensions: [StarterKit, CommentAnchorExtension],
    content: markdownToEditorHtml(markdown),
    editorProps: {
      attributes: {
        class: "editor-surface__prose",
      },
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { empty, from, to } = currentEditor.state.selection;
      if (empty) {
        onSelectionChange(null);
        return;
      }

      const text = currentEditor.state.doc.textBetween(from, to, " ").trim();
      onSelectionChange(
        text
          ? {
              text,
              threadId: getThreadIdFromSelection(currentEditor),
            }
          : null,
      );
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextMarkdown = editorJsonToMarkdown(currentEditor.getJSON());
      lastSyncedMarkdownRef.current = nextMarkdown;
      onMarkdownChange(nextMarkdown);
    },
  });

  useEffect(() => {
    if (!editor || markdown === lastSyncedMarkdownRef.current) {
      return;
    }

    lastSyncedMarkdownRef.current = markdown;
    editor.commands.setContent(markdownToEditorHtml(markdown));
  }, [editor, markdown]);

  useImperativeHandle(ref, () => ({
    applyThreadToSelection(threadId) {
      if (!editor || editor.state.selection.empty) {
        return null;
      }

      editor.chain().focus().setMark("commentAnchor", { threadId }).run();
      const markdownDocument = editorJsonToMarkdown(editor.getJSON());
      onMarkdownChange(markdownDocument);
      onSelectionChange(null);
      return markdownDocument;
    },
    focusThread(threadId) {
      const root = rootRef.current;
      const mark = root?.querySelector(
        `[data-comment-thread="${threadId}"]`,
      ) as HTMLElement | null;
      if (!editor || !mark) {
        return;
      }

      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      let anchorFrom: number | null = null;
      let anchorTo: number | null = null;
      const anchorMark = editor.schema.marks.commentAnchor;
      if (!anchorMark) {
        return;
      }

      editor.state.doc.descendants((node, position) => {
        const matchedMark = node.marks.find(
          (candidate) =>
            candidate.type === anchorMark &&
            candidate.attrs.threadId === threadId,
        );
        if (node.isText && matchedMark && node.text) {
          anchorFrom = position;
          anchorTo = position + node.text.length;
          return false;
        }

        return undefined;
      });

      if (anchorFrom === null || anchorTo === null) {
        return;
      }

      const selection = TextSelection.create(
        editor.state.doc,
        anchorFrom,
        anchorTo,
      );
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    },
  }));

  useEffect(() => {
    if (!editor) {
      return;
    }

    const root = rootRef.current;
    const clickHandler = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const threadElement = target.closest("[data-comment-thread]");
      const threadId = threadElement?.getAttribute("data-comment-thread");
      if (threadId) {
        onThreadClick(threadId);
      }
    };

    root?.addEventListener("click", clickHandler);
    return () => {
      root?.removeEventListener("click", clickHandler);
    };
  }, [editor, onThreadClick]);

  return (
    <div className="editor-surface" ref={rootRef}>
      <EditorContent editor={editor} />
    </div>
  );
});
