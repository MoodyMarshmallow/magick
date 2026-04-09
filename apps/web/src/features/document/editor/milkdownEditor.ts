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
import type { Selection } from "@milkdown/prose/state";
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
  selection: Selection = view.state.selection,
) => {
  callbacks.onFormatStateChange(getEditorFormatState(view, selection));
  callbacks.onSelectionChange(getEditorSelectionState(view, selection));
};

const createDeferredViewStateSync = (
  root: HTMLElement,
  callbacks: MilkdownEditorCallbacks,
) => {
  const viewWindow = root.ownerDocument.defaultView;
  let frameId: number | null = null;

  const cancel = () => {
    if (frameId === null || !viewWindow) {
      frameId = null;
      return;
    }

    viewWindow.cancelAnimationFrame(frameId);
    frameId = null;
  };

  const schedule = (view: EditorView) => {
    cancel();

    if (!viewWindow) {
      syncViewState(view, callbacks);
      return;
    }

    frameId = viewWindow.requestAnimationFrame(() => {
      frameId = null;
      syncViewState(view, callbacks);
    });
  };

  return { cancel, schedule };
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
  const deferredViewStateSync = createDeferredViewStateSync(root, callbacks);

  const editor = await Editor.make()
    .config(nord)
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(rootAttrsCtx, {
        class: "milkdown milkdown-theme-nord editor-surface__prose",
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
        .selectionUpdated((listenerCtxValue, selection) => {
          const view = listenerCtxValue.get(editorViewCtx);
          syncViewState(view, callbacks, selection);
          deferredViewStateSync.schedule(view);
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
      deferredViewStateSync.cancel();
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
