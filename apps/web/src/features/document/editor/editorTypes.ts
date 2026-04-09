export interface EditorSelectionState {
  readonly text: string;
}

export type EditorHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

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

export interface EditorCommandOptions {
  readonly level?: EditorHeadingLevel;
}

export interface EditorSurfaceHandle {
  runCommand: (
    commandName: EditorCommandName,
    options?: EditorCommandOptions,
  ) => void;
}
