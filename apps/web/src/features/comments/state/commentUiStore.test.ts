import { useCommentUiStore } from "./commentUiStore";

describe("commentUiStore", () => {
  beforeEach(() => {
    useCommentUiStore.setState({
      activeThreadId: null,
      selection: null,
    });
  });

  it("starts with no active thread or selection", () => {
    expect(useCommentUiStore.getState()).toMatchObject({
      activeThreadId: null,
      selection: null,
    });
  });

  it("tracks the active thread id", () => {
    useCommentUiStore.getState().setActiveThreadId("thread_1");

    expect(useCommentUiStore.getState().activeThreadId).toBe("thread_1");
  });

  it("stores and clears the current selection", () => {
    useCommentUiStore.getState().setSelection({
      text: "Anchored sentence",
      threadId: "thread_1",
    });

    expect(useCommentUiStore.getState().selection).toEqual({
      text: "Anchored sentence",
      threadId: "thread_1",
    });

    useCommentUiStore.getState().setSelection(null);

    expect(useCommentUiStore.getState().selection).toBeNull();
  });
});
