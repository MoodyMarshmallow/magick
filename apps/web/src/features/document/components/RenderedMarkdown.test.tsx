// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { RenderedMarkdown } from "./RenderedMarkdown";

describe("RenderedMarkdown", () => {
  it("renders inline code, fenced code blocks, math, and safe external links", () => {
    const { container } = render(
      <RenderedMarkdown
        content={
          "`inline code`\n\n```ts\nconst value = 42;\n```\n\n[docs](https://example.com)\n\n$E = mc^2$"
        }
      />,
    );

    expect(screen.getByText("inline code").tagName).toBe("CODE");
    expect(container.querySelector("pre code.hljs.language-ts")).toBeTruthy();
    expect(container.querySelector("pre .hljs-keyword")?.textContent).toBe(
      "const",
    );
    expect(
      screen.getByRole("link", { name: "docs" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(
      screen.getByRole("link", { name: "docs" }).getAttribute("target"),
    ).toBe("_blank");
    expect(screen.getByRole("link", { name: "docs" }).getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(container.querySelector(".katex")).toBeTruthy();
  });
});
