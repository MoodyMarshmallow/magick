import { isValidElement } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import {
  getCodeBlockLanguage,
  isMermaidLanguage,
  renderedMarkdownRemarkPlugins,
} from "../editor/milkdownMarkdownDialect";
import { MermaidDiagram } from "./MermaidDiagram";

interface RenderedMarkdownProps {
  readonly content: string;
  readonly className?: string;
}

const joinClassName = (...classNames: Array<string | undefined>) => {
  return classNames.filter(Boolean).join(" ");
};

const isMermaidPreBlock = (children: unknown): boolean => {
  if (!isValidElement<{ className?: string }>(children)) {
    return false;
  }

  const className =
    typeof children.props.className === "string"
      ? children.props.className
      : undefined;

  return isMermaidLanguage(getCodeBlockLanguage(className));
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
          pre: ({ node: _node, children, ...props }) => {
            if (isMermaidPreBlock(children)) {
              return children;
            }

            return <pre {...props}>{children}</pre>;
          },
          code: ({ node: _node, className, children, ...props }) => {
            const language = getCodeBlockLanguage(className);
            const source = String(children).replace(/\n$/, "");

            if (isMermaidLanguage(language)) {
              return <MermaidDiagram source={source} />;
            }

            return (
              <code {...props} className={className}>
                {children}
              </code>
            );
          },
        }}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        remarkPlugins={[...renderedMarkdownRemarkPlugins]}
      >
        {content}
      </Markdown>
    </div>
  );
}
