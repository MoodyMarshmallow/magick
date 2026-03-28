import { Mark, mergeAttributes } from "@tiptap/core";

export const CommentAnchorExtension = Mark.create({
  name: "commentAnchor",

  inclusive: true,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-thread"),
        renderHTML: (attributes) => ({
          "data-comment-thread": attributes.threadId,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-thread]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "comment-anchor-mark",
      }),
      0,
    ];
  },
});
