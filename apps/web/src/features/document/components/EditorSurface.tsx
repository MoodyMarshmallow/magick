import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  type MouseEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  editorJsonToMarkdown,
  markdownToEditorHtml,
} from "../editor/commentAnchors";

export interface EditorSelectionState {
  readonly text: string;
}

export interface EditorFormatState {
  readonly paragraph: boolean;
  readonly headingLevel: EditorHeadingLevel | null;
  readonly bulletList: boolean;
  readonly orderedList: boolean;
  readonly blockquote: boolean;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly strike: boolean;
  readonly code: boolean;
}

export type EditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type EditorCommandName =
  | "setParagraph"
  | "setHeading"
  | "toggleHeading"
  | "toggleBulletList"
  | "toggleOrderedList"
  | "toggleBlockquote"
  | "toggleBold"
  | "toggleItalic"
  | "toggleStrike"
  | "toggleCode";

interface EditorCommandOptions {
  readonly level?: EditorHeadingLevel;
}

export interface EditorSurfaceHandle {
  runCommand: (
    commandName: EditorCommandName,
    options?: EditorCommandOptions,
  ) => void;
}

interface EditorSurfaceProps {
  readonly markdown: string;
  readonly onFormatStateChange: (state: EditorFormatState) => void;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onSelectionChange: (selection: EditorSelectionState | null) => void;
}

const getEditorFormatState = (
  editor: NonNullable<ReturnType<typeof useEditor>>,
): EditorFormatState => ({
  paragraph: editor.isActive("paragraph"),
  headingLevel:
    ([1, 2, 3, 4, 5, 6] as const).find((level) =>
      editor.isActive("heading", { level }),
    ) ?? null,
  bulletList: editor.isActive("bulletList"),
  orderedList: editor.isActive("orderedList"),
  blockquote: editor.isActive("blockquote"),
  bold: editor.isActive("bold"),
  italic: editor.isActive("italic"),
  strike: editor.isActive("strike"),
  code: editor.isActive("code"),
});

const runEditorCommand = (
  editor: NonNullable<ReturnType<typeof useEditor>>,
  commandName: EditorCommandName,
  options?: EditorCommandOptions,
) => {
  switch (commandName) {
    case "setParagraph":
      editor.chain().focus().setParagraph().run();
      break;
    case "toggleHeading":
      editor
        .chain()
        .focus()
        .toggleHeading({ level: options?.level ?? 1 })
        .run();
      break;
    case "setHeading":
      editor
        .chain()
        .focus()
        .setHeading({ level: options?.level ?? 1 })
        .run();
      break;
    case "toggleBulletList":
      editor.chain().focus().toggleBulletList().run();
      break;
    case "toggleOrderedList":
      editor.chain().focus().toggleOrderedList().run();
      break;
    case "toggleBlockquote":
      editor.chain().focus().toggleBlockquote().run();
      break;
    case "toggleBold":
      editor.chain().focus().toggleBold().run();
      break;
    case "toggleItalic":
      editor.chain().focus().toggleItalic().run();
      break;
    case "toggleStrike":
      editor.chain().focus().toggleStrike().run();
      break;
    case "toggleCode":
      editor.chain().focus().toggleCode().run();
      break;
  }
};

export const EditorSurface = forwardRef<
  EditorSurfaceHandle,
  EditorSurfaceProps
>(function EditorSurface(
  { markdown, onFormatStateChange, onMarkdownChange, onSelectionChange },
  ref,
) {
  const lastSyncedMarkdownRef = useRef(markdown);
  const editor = useEditor({
    extensions: [StarterKit],
    content: markdownToEditorHtml(markdown),
    editorProps: {
      attributes: {
        class: "editor-surface__prose",
      },
      handleDOMEvents: {
        dragenter: (_, event) => {
          event.preventDefault();
          return true;
        },
        dragover: (_, event) => {
          event.preventDefault();
          return true;
        },
        drop: (_, event) => {
          event.preventDefault();
          return true;
        },
      },
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      onFormatStateChange(getEditorFormatState(currentEditor));
      const { empty, from, to } = currentEditor.state.selection;
      if (empty) {
        onSelectionChange(null);
        return;
      }

      const text = currentEditor.state.doc.textBetween(from, to, " ").trim();
      onSelectionChange(text ? { text } : null);
    },
    onUpdate: ({ editor: currentEditor }) => {
      onFormatStateChange(getEditorFormatState(currentEditor));
      const nextMarkdown = editorJsonToMarkdown(currentEditor.getJSON());
      lastSyncedMarkdownRef.current = nextMarkdown;
      onMarkdownChange(nextMarkdown);
    },
    onCreate: ({ editor: currentEditor }) => {
      onFormatStateChange(getEditorFormatState(currentEditor));
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
    runCommand(commandName, options) {
      if (!editor) {
        return;
      }

      runEditorCommand(editor, commandName, options);
      onFormatStateChange(getEditorFormatState(editor));
    },
  }));

  const handleSurfaceMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!editor) {
      return;
    }

    if (
      event.target !== event.currentTarget &&
      event.target !== editor.view.dom
    ) {
      return;
    }

    editor.commands.focus("end");
  };

  return (
    <div className="editor-surface" onMouseDown={handleSurfaceMouseDown}>
      <EditorContent editor={editor} />
    </div>
  );
});
