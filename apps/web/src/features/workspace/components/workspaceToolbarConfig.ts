import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Pilcrow,
  Quote,
  Strikethrough,
} from "lucide-react";
import type {
  EditorCommandName,
  EditorFormatState,
} from "../../document/components/EditorSurface";

export const defaultEditorFormatState: EditorFormatState = {
  paragraph: true,
  heading1: false,
  heading2: false,
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
    label: "Paragraph",
    icon: Pilcrow,
    commandName: "setParagraph",
    isActive: (state) => state.paragraph,
  },
  {
    label: "Heading 1",
    icon: Heading1,
    commandName: "toggleHeading1",
    isActive: (state) => state.heading1,
  },
  {
    label: "Heading 2",
    icon: Heading2,
    commandName: "toggleHeading2",
    isActive: (state) => state.heading2,
  },
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
