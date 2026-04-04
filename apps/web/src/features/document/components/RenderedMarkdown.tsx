import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface RenderedMarkdownProps {
  readonly content: string;
  readonly className?: string;
}

const joinClassName = (...classNames: Array<string | undefined>) => {
  return classNames.filter(Boolean).join(" ");
};

export function RenderedMarkdown({
  content,
  className,
}: RenderedMarkdownProps) {
  return (
    <div className={joinClassName("rendered-markdown", className)}>
      <Markdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noopener noreferrer" target="_blank" />
          ),
        }}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {content}
      </Markdown>
    </div>
  );
}
