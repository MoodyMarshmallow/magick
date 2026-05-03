import {
  type MouseEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type {
  EditorCommandOptions,
  EditorFormatState,
  EditorSelectionState,
  EditorSurfaceHandle,
} from "../editor/editorTypes";
import {
  type MilkdownEditorController,
  createMilkdownEditor,
} from "../editor/milkdownEditor";
export type {
  EditorCommandName,
  EditorFormatState,
  EditorHeadingLevel,
  EditorSelectionState,
  EditorSurfaceHandle,
} from "../editor/editorTypes";

interface EditorSurfaceProps {
  readonly markdown: string;
  readonly onFormatStateChange: (state: EditorFormatState) => void;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onSelectionChange: (selection: EditorSelectionState | null) => void;
}

export const EditorSurface = forwardRef<
  EditorSurfaceHandle,
  EditorSurfaceProps
>(function EditorSurface(
  { markdown, onFormatStateChange, onMarkdownChange, onSelectionChange },
  ref,
) {
  const initialMarkdownRef = useRef(markdown);
  const lastSyncedMarkdownRef = useRef(markdown);
  const latestMarkdownRef = useRef(markdown);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MilkdownEditorController | null>(null);
  const onFormatStateChangeRef = useRef(onFormatStateChange);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const onSelectionChangeRef = useRef(onSelectionChange);

  onFormatStateChangeRef.current = onFormatStateChange;
  onMarkdownChangeRef.current = onMarkdownChange;
  onSelectionChangeRef.current = onSelectionChange;
  latestMarkdownRef.current = markdown;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let isDisposed = false;
    const editorMount = root.ownerDocument.createElement("div");
    editorMount.className = "editor-surface__mount";
    root.replaceChildren(editorMount);

    void createMilkdownEditor({
      markdown: initialMarkdownRef.current,
      root: editorMount,
      onFormatStateChange: (state) => {
        onFormatStateChangeRef.current(state);
      },
      onMarkdownChange: (nextMarkdown) => {
        lastSyncedMarkdownRef.current = nextMarkdown;
        onMarkdownChangeRef.current(nextMarkdown);
      },
      onSelectionChange: (selection) => {
        onSelectionChangeRef.current(selection);
      },
    }).then((controller) => {
      if (isDisposed) {
        void controller.destroy().finally(() => {
          editorMount.remove();
        });
        return;
      }

      editorRef.current = controller;

      if (latestMarkdownRef.current !== lastSyncedMarkdownRef.current) {
        lastSyncedMarkdownRef.current = latestMarkdownRef.current;
        controller.replaceMarkdown(latestMarkdownRef.current);
      }
    });

    return () => {
      isDisposed = true;
      const controller = editorRef.current;
      editorRef.current = null;
      if (controller) {
        void controller.destroy().finally(() => {
          editorMount.remove();
        });
        return;
      }

      editorMount.remove();
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || markdown === lastSyncedMarkdownRef.current) {
      return;
    }

    lastSyncedMarkdownRef.current = markdown;
    editorRef.current.replaceMarkdown(markdown);
  }, [markdown]);

  useImperativeHandle(ref, () => ({
    runCommand(commandName, options) {
      editorRef.current?.runCommand(commandName, options);
    },
  }));

  const handleSurfaceMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!editorRef.current) {
      return;
    }

    if (
      event.target !== event.currentTarget &&
      event.target !== rootRef.current &&
      !(
        event.target instanceof HTMLElement &&
        event.target.classList.contains("editor-surface__mount")
      )
    ) {
      return;
    }

    editorRef.current.focusAtEnd();
  };

  return (
    <div className="editor-surface" onMouseDown={handleSurfaceMouseDown}>
      <div className="editor-surface__root" ref={rootRef} />
    </div>
  );
});
