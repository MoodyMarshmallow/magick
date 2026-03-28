import { create } from "zustand";

export interface SelectionState {
  readonly text: string;
  readonly threadId: string | null;
}

interface CommentUiState {
  readonly activeThreadId: string | null;
  readonly selection: SelectionState | null;
  setActiveThreadId: (threadId: string | null) => void;
  setSelection: (selection: SelectionState | null) => void;
}

export const useCommentUiStore = create<CommentUiState>((set) => ({
  activeThreadId: null,
  selection: null,
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setSelection: (selection) => set({ selection }),
}));
