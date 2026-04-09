import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// Magick's document editor persists CommonMark with key GFM features,
// KaTeX math, and Mermaid fenced diagrams as the canonical source format.
export const renderedMarkdownRemarkPlugins = [remarkGfm, remarkMath] as const;

export const getCodeBlockLanguage = (className?: string): string | null => {
  const languageClassName = className
    ?.split(/\s+/)
    .find((token) => token.startsWith("language-"));

  return languageClassName ? languageClassName.slice("language-".length) : null;
};

export const isMermaidLanguage = (
  language: string | null | undefined,
): boolean => {
  return language?.trim().toLowerCase() === "mermaid";
};
