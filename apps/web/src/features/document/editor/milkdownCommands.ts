import type { CommandManager, Editor } from "@milkdown/core";
import { commandsCtx, editorViewCtx } from "@milkdown/core";
import {
  lift,
  setBlockType,
  toggleMark,
  wrapIn,
} from "@milkdown/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";
import { Selection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorCommandName, EditorCommandOptions } from "./editorTypes";
import { getEditorFormatState } from "./milkdownFormatState";

const getHeadingLevel = (options?: EditorCommandOptions): number => {
  return options?.level ?? 1;
};

const requireNode = <T>(value: T | undefined): T | null => {
  return value ?? null;
};

const requireMark = <T>(value: T | undefined): T | null => {
  return value ?? null;
};

export const focusEditorAtEnd = (editor: Editor): void => {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const selection = Selection.atEnd(view.state.doc);
    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
    view.focus();
  });
};

const liftFromCurrentBlock = (
  commandManager: CommandManager,
  view: EditorView,
  formatState: ReturnType<typeof getEditorFormatState>,
): void => {
  const listItem = view.state.schema.nodes.list_item;

  if ((formatState.bulletList || formatState.orderedList) && listItem) {
    commandManager.inline(liftListItem(listItem));
  }

  if (formatState.blockquote) {
    commandManager.inline(lift);
  }
};

export const runEditorCommand = (
  editor: Editor,
  commandName: EditorCommandName,
  options?: EditorCommandOptions,
): void => {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const commandManager = ctx.get(commandsCtx);
    const formatState = getEditorFormatState(view);
    const { schema } = view.state;

    view.focus();

    switch (commandName) {
      case "setParagraph": {
        const paragraph = requireNode(schema.nodes.paragraph);
        if (!paragraph) {
          break;
        }

        liftFromCurrentBlock(commandManager, view, formatState);
        commandManager.inline(setBlockType(paragraph));
        break;
      }
      case "setHeading": {
        const heading = requireNode(schema.nodes.heading);
        if (!heading) {
          break;
        }

        liftFromCurrentBlock(commandManager, view, formatState);
        commandManager.inline(
          setBlockType(heading, {
            level: getHeadingLevel(options),
          }),
        );
        break;
      }
      case "toggleHeading": {
        const paragraph = requireNode(schema.nodes.paragraph);
        const heading = requireNode(schema.nodes.heading);
        if (!paragraph || !heading) {
          break;
        }

        const headingLevel = getHeadingLevel(options);
        if (formatState.headingLevel === headingLevel) {
          liftFromCurrentBlock(commandManager, view, formatState);
          commandManager.inline(setBlockType(paragraph));
          break;
        }

        liftFromCurrentBlock(commandManager, view, formatState);
        commandManager.inline(
          setBlockType(heading, {
            level: headingLevel,
          }),
        );
        break;
      }
      case "toggleBulletList": {
        const bulletList = requireNode(schema.nodes.bullet_list);
        if (!bulletList) {
          break;
        }

        if (formatState.bulletList) {
          const listItem = schema.nodes.list_item;
          if (listItem) {
            commandManager.inline(liftListItem(listItem));
          }
          break;
        }

        if (formatState.orderedList) {
          const listItem = schema.nodes.list_item;
          if (listItem) {
            commandManager.inline(liftListItem(listItem));
          }
        }

        commandManager.inline(wrapInList(bulletList));
        break;
      }
      case "toggleOrderedList": {
        const orderedList = requireNode(schema.nodes.ordered_list);
        if (!orderedList) {
          break;
        }

        if (formatState.orderedList) {
          const listItem = schema.nodes.list_item;
          if (listItem) {
            commandManager.inline(liftListItem(listItem));
          }
          break;
        }

        if (formatState.bulletList) {
          const listItem = schema.nodes.list_item;
          if (listItem) {
            commandManager.inline(liftListItem(listItem));
          }
        }

        commandManager.inline(wrapInList(orderedList));
        break;
      }
      case "toggleBlockquote": {
        const blockquote = requireNode(schema.nodes.blockquote);
        if (!blockquote) {
          break;
        }

        if (formatState.blockquote) {
          commandManager.inline(lift);
          break;
        }

        commandManager.inline(wrapIn(blockquote));
        break;
      }
      case "toggleBold": {
        const strong = requireMark(schema.marks.strong);
        if (!strong) {
          break;
        }

        commandManager.inline(toggleMark(strong));
        break;
      }
      case "toggleItalic": {
        const emphasis = requireMark(schema.marks.emphasis);
        if (!emphasis) {
          break;
        }

        commandManager.inline(toggleMark(emphasis));
        break;
      }
      case "toggleStrike": {
        const strikeThrough = requireMark(schema.marks.strike_through);
        if (!strikeThrough) {
          break;
        }

        commandManager.inline(toggleMark(strikeThrough));
        break;
      }
      case "toggleCode": {
        const inlineCode = requireMark(schema.marks.inlineCode);
        if (!inlineCode) {
          break;
        }

        commandManager.inline(toggleMark(inlineCode));
        break;
      }
    }
  });
};
