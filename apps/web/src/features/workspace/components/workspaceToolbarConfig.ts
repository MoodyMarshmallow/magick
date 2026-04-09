import {
  Bold,
  Code2,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  Strikethrough,
} from "lucide-react";
import type {
  EditorCommandName,
  EditorFormatState,
} from "../../document/editor/editorTypes";

export const defaultEditorFormatState: EditorFormatState = {
  paragraph: true,
  headingLevel: null,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  bold: false,
  italic: false,
  strike: false,
  code: false,
};

export const editorToolbarActions: readonly {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly commandName: EditorCommandName;
  readonly isActive: (state: EditorFormatState) => boolean;
}[] = [
  {
    label: "Bold",
    icon: Bold,
    commandName: "toggleBold",
    isActive: (state) => state.bold,
  },
  {
    label: "Italic",
    icon: Italic,
    commandName: "toggleItalic",
    isActive: (state) => state.italic,
  },
  {
    label: "Strike",
    icon: Strikethrough,
    commandName: "toggleStrike",
    isActive: (state) => state.strike,
  },
  {
    label: "Bullet List",
    icon: List,
    commandName: "toggleBulletList",
    isActive: (state) => state.bulletList,
  },
  {
    label: "Ordered List",
    icon: ListOrdered,
    commandName: "toggleOrderedList",
    isActive: (state) => state.orderedList,
  },
  {
    label: "Quote",
    icon: Quote,
    commandName: "toggleBlockquote",
    isActive: (state) => state.blockquote,
  },
  {
    label: "Inline Code",
    icon: Code2,
    commandName: "toggleCode",
    isActive: (state) => state.code,
  },
];
