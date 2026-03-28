import { useQuery } from "@tanstack/react-query";
import {
  Asterisk,
  CircleDot,
  Crosshair,
  FileText,
  FolderTree,
  LocateFixed,
  MessageSquareQuote,
  MoonStar,
  ScanLine,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CommentSidebar } from "../features/comments/components/CommentSidebar";
import {
  demoDocumentId,
  demoMagickClient,
} from "../features/comments/data/demoMagickClient";
import {
  type SelectionState,
  useCommentUiStore,
} from "../features/comments/state/commentUiStore";
import {
  type CommentThread,
  projectThreadEvent,
} from "../features/comments/state/threadProjector";
import {
  type EditorSelectionState,
  EditorSurface,
  type EditorSurfaceHandle,
} from "../features/document/components/EditorSurface";
import { AuthStatus } from "../features/providers/components/AuthStatus";

export function AppShell() {
  const editorRef = useRef<EditorSurfaceHandle | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [threads, dispatch] = useReducer(
    projectThreadEvent,
    [] as readonly CommentThread[],
  );
  const { activeThreadId, selection, setActiveThreadId, setSelection } =
    useCommentUiStore();

  const bootstrapQuery = useQuery({
    queryKey: ["document-bootstrap", demoDocumentId],
    queryFn: () => demoMagickClient.getDocumentBootstrap(demoDocumentId),
  });

  useEffect(() => {
    if (!bootstrapQuery.data) {
      return;
    }

    setMarkdown(bootstrapQuery.data.markdown);
    dispatch({
      type: "snapshot.loaded",
      threads: bootstrapQuery.data.threads,
    });
    setActiveThreadId(bootstrapQuery.data.threads[0]?.threadId ?? null);
  }, [bootstrapQuery.data, setActiveThreadId]);

  useEffect(() => {
    return demoMagickClient.subscribe((event) => {
      dispatch(event);
    });
  }, []);

  const activeDocumentTitle = bootstrapQuery.data?.title ?? "Loading document";
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.threadId === activeThreadId) ?? null,
    [activeThreadId, threads],
  );

  const handleSelectionChange = (
    nextSelection: EditorSelectionState | null,
  ) => {
    const mappedSelection: SelectionState | null = nextSelection
      ? {
          text: nextSelection.text,
          threadId: nextSelection.threadId,
        }
      : null;
    setSelection(mappedSelection);
  };

  const handleActivateThread = (threadId: string) => {
    setActiveThreadId(threadId);
    editorRef.current?.focusThread(threadId);
  };

  if (bootstrapQuery.isLoading) {
    return (
      <div className="app-shell app-shell--loading">Loading Magick...</div>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data) {
    return (
      <div className="app-shell app-shell--loading">
        Failed to load the document workspace.
      </div>
    );
  }

  return (
    <main className="app-shell">
      <aside className="left-rail">
        {/* <header className="masthead">
          <div className="masthead__sigil" aria-hidden="true">
            <MoonStar size={18} />
            <Asterisk size={18} />
          </div>
          <div>
            <p className="eyebrow">Magick</p>
            <h1>Digital review chamber</h1>
            <p className="masthead__copy">
              A raw document console where every comment opens a durable thread.
            </p>
          </div>
        </header> */}

        {/* <AuthStatus /> */}

        <section className="sidebar-section rail-section">
          <div className="sidebar-section__header rail-section__header">
            <span>Index</span>
            <FolderTree size={16} />
          </div>
          <button className="document-entry is-active" type="button">
            <span className="document-entry__icon">
              <FileText size={16} />
            </span>
            <span className="document-entry__body">
              <strong>{activeDocumentTitle}</strong>
              <span>{threads.length} threads</span>
            </span>
          </button>
          <button className="document-entry" type="button">
            <span className="document-entry__icon">
              <FileText size={16} />
            </span>
            <span className="document-entry__body">
              <strong>Design system field notes</strong>
              <span>sealed / pending</span>
            </span>
          </button>
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace__header">
          <div className="workspace__titleblock">
            <h2>{activeDocumentTitle}</h2>
          </div>
          <div className="workspace__statusline">
            <span>
              <CircleDot size={14} />
              {markdown.length} chars persisted
            </span>
            <span>
              <Crosshair size={14} />
              {selection?.threadId
                ? `bound to ${selection.threadId}`
                : selection?.text
                  ? "selection ready"
                  : "no active selection"}
            </span>
            <span>
              <LocateFixed size={14} />
              {selectedThread
                ? `focus ${selectedThread.threadId}`
                : "no thread focused"}
            </span>
          </div>
        </header>

        <section className="workspace__canvas">
          <div className="workspace__frame">
            <EditorSurface
              ref={editorRef}
              markdown={markdown}
              onMarkdownChange={(nextMarkdown) => {
                setMarkdown(nextMarkdown);
                demoMagickClient.updateDocumentMarkup(nextMarkdown);
              }}
              onSelectionChange={handleSelectionChange}
              onThreadClick={handleActivateThread}
            />
          </div>
        </section>
      </section>

      <CommentSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onActivateThread={handleActivateThread}
        onSendReply={async (threadId: string, message: string) => {
          await demoMagickClient.sendReply({ threadId, body: message });
          setActiveThreadId(threadId);
        }}
        onToggleResolved={async (threadId: string) => {
          await demoMagickClient.toggleResolved(threadId);
        }}
      />
    </main>
  );
}
