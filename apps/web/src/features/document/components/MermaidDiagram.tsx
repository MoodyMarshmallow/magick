import mermaid from "mermaid";
import { useEffect, useId, useRef, useState } from "react";

interface MermaidDiagramProps {
  readonly source: string;
}

let isMermaidInitialized = false;

const ensureMermaid = () => {
  if (isMermaidInitialized) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
  });
  isMermaidInitialized = true;
};

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const diagramId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    ensureMermaid();
    setSvg(null);
    setError(null);

    void mermaid
      .render(`magick-mermaid-${diagramId.replace(/:/g, "-")}`, source)
      .then(({ svg: nextSvg }) => {
        if (cancelled) {
          return;
        }

        setSvg(nextSvg);
      })
      .catch((renderError: unknown) => {
        if (cancelled) {
          return;
        }

        setError(
          renderError instanceof Error
            ? renderError.message
            : "Failed to render Mermaid diagram.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [diagramId, source]);

  useEffect(() => {
    if (!containerRef.current || !svg) {
      return;
    }

    containerRef.current.innerHTML = svg;

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [svg]);

  if (error) {
    return (
      <div className="rendered-mermaid rendered-mermaid--error">
        <p className="rendered-mermaid__error">
          Mermaid render failed: {error}
        </p>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="rendered-mermaid rendered-mermaid--loading">
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      aria-label="Mermaid diagram"
      className="rendered-mermaid"
      ref={containerRef}
    />
  );
}
