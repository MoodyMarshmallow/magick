import { useQuery } from "@tanstack/react-query";
import {
  CircleDot,
  Crosshair,
  FileText,
  FolderTree,
  LocateFixed,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CommentSidebar } from "../features/comments/components/CommentSidebar";
import { workspaceClient } from "../features/comments/data/workspaceClient";
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

export function AppShell() {
  const editorRef = useRef<EditorSurfaceHandle | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [threads, dispatch] = useReducer(
    projectThreadEvent,
    [] as readonly CommentThread[],
  );
  const { activeThreadId, selection, setActiveThreadId, setSelection } =
    useCommentUiStore();

  const bootstrapQuery = useQuery({
    queryKey: ["workspace-bootstrap"],
    queryFn: () => workspaceClient.getWorkspaceBootstrap(),
  });

  const documentQuery = useQuery({
    enabled: activeDocumentId !== null,
    queryKey: ["document", activeDocumentId],
    queryFn: async () => {
      if (!activeDocumentId) {
        throw new Error("No active document selected.");
      }

      return workspaceClient.openDocument(activeDocumentId);
    },
  });

  useEffect(() => {
    if (!bootstrapQuery.data || activeDocumentId) {
      return;
    }

    setActiveDocumentId(bootstrapQuery.data.documents[0]?.documentId ?? null);
  }, [activeDocumentId, bootstrapQuery.data]);

  useEffect(() => {
    if (!documentQuery.data) {
      return;
    }

    setMarkdown(documentQuery.data.markdown);
    dispatch({
      type: "snapshot.loaded",
      threads: documentQuery.data.threads,
    });
    setActiveThreadId(documentQuery.data.threads[0]?.threadId ?? null);
  }, [documentQuery.data, setActiveThreadId]);

  useEffect(() => {
    return workspaceClient.subscribe((event) => {
      dispatch(event);
    });
  }, []);

  const activeDocumentTitle = documentQuery.data?.title ?? "Loading document";
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

  if (
    bootstrapQuery.isLoading ||
    (activeDocumentId !== null && documentQuery.isLoading)
  ) {
    return (
      <div className="app-shell app-shell--loading">Loading Magick...</div>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data || documentQuery.isError) {
    return (
      <div className="app-shell app-shell--loading">
        Failed to load the document workspace.
      </div>
    );
  }

  const documents = bootstrapQuery.data.documents;

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
          {documents.map((document) => (
            <button
              className={`document-entry${
                document.documentId === activeDocumentId ? " is-active" : ""
              }`}
              key={document.documentId}
              onClick={() => setActiveDocumentId(document.documentId)}
              type="button"
            >
              <span className="document-entry__icon">
                <FileText size={16} />
              </span>
              <span className="document-entry__body">
                <strong>{document.title}</strong>
                <span>{document.threadCount} threads</span>
              </span>
            </button>
          ))}
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
                if (activeDocumentId) {
                  void workspaceClient.saveDocument(
                    activeDocumentId,
                    nextMarkdown,
                  );
                }
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
          await workspaceClient.sendThreadMessage(threadId, message);
          setActiveThreadId(threadId);
        }}
        onToggleResolved={async (threadId: string) => {
          await workspaceClient.toggleThreadResolved(threadId);
        }}
      />
    </main>
  );
}
