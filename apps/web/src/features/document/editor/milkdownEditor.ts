import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootAttrsCtx,
  rootCtx,
} from "@milkdown/core";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { katexOptionsCtx, math } from "@milkdown/plugin-math";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import type { EditorView } from "@milkdown/prose/view";
import { nord } from "@milkdown/theme-nord";
import "@milkdown/theme-nord/style.css";
import { replaceAll } from "@milkdown/utils";
import type {
  EditorCommandName,
  EditorCommandOptions,
  EditorFormatState,
  EditorSelectionState,
} from "./editorTypes";
import { focusEditorAtEnd, runEditorCommand } from "./milkdownCommands";
import {
  getEditorFormatState,
  getEditorSelectionState,
} from "./milkdownFormatState";

interface MilkdownEditorCallbacks {
  readonly onFormatStateChange: (state: EditorFormatState) => void;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onSelectionChange: (selection: EditorSelectionState | null) => void;
}

interface CreateMilkdownEditorOptions extends MilkdownEditorCallbacks {
  readonly markdown: string;
  readonly root: HTMLElement;
}

export interface MilkdownEditorController {
  destroy: () => Promise<void>;
  focusAtEnd: () => void;
  replaceMarkdown: (markdown: string) => void;
  runCommand: (
    commandName: EditorCommandName,
    options?: EditorCommandOptions,
  ) => void;
}

const syncViewState = (
  view: EditorView,
  callbacks: MilkdownEditorCallbacks,
) => {
  callbacks.onFormatStateChange(getEditorFormatState(view));
  callbacks.onSelectionChange(getEditorSelectionState(view));
};

export const createMilkdownEditor = async ({
  markdown,
  root,
  onFormatStateChange,
  onMarkdownChange,
  onSelectionChange,
}: CreateMilkdownEditorOptions): Promise<MilkdownEditorController> => {
  const callbacks: MilkdownEditorCallbacks = {
    onFormatStateChange,
    onMarkdownChange,
    onSelectionChange,
  };

  const editor = await Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(rootAttrsCtx, {
        class: "milkdown editor-surface__prose",
      });
      ctx.set(defaultValueCtx, markdown);
      ctx.set(katexOptionsCtx.key, {
        strict: "ignore",
        throwOnError: false,
      });
      ctx.set(editorViewOptionsCtx, {
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
      });

      ctx
        .get(listenerCtx)
        .mounted((listenerCtxValue) => {
          syncViewState(listenerCtxValue.get(editorViewCtx), callbacks);
        })
        .updated((listenerCtxValue) => {
          syncViewState(listenerCtxValue.get(editorViewCtx), callbacks);
        })
        .selectionUpdated((listenerCtxValue) => {
          syncViewState(listenerCtxValue.get(editorViewCtx), callbacks);
        })
        .markdownUpdated((_listenerCtxValue, nextMarkdown) => {
          onMarkdownChange(nextMarkdown);
        });
    })
    .use(commonmark)
    .use(gfm)
    .use(math)
    .use(history)
    .use(listener)
    .create();

  return {
    destroy: async () => {
      await editor.destroy();
    },
    focusAtEnd: () => {
      focusEditorAtEnd(editor);
    },
    replaceMarkdown: (nextMarkdown) => {
      editor.action(replaceAll(nextMarkdown, true));
      syncViewState(
        editor.action((ctx) => ctx.get(editorViewCtx)),
        callbacks,
      );
    },
    runCommand: (commandName, options) => {
      runEditorCommand(editor, commandName, options);
      syncViewState(
        editor.action((ctx) => ctx.get(editorViewCtx)),
        callbacks,
      );
    },
  };
};
