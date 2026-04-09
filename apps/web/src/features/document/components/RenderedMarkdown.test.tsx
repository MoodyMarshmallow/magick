// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { RenderedMarkdown } from "./RenderedMarkdown";

const { renderMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderMock,
  },
}));

describe("RenderedMarkdown", () => {
  beforeEach(() => {
    renderMock.mockReset();
    renderMock.mockResolvedValue({ svg: "<svg><text>Flow</text></svg>" });
  });

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

  it("renders Mermaid fences through the Mermaid renderer", async () => {
    const { container } = render(
      <RenderedMarkdown content={"```mermaid\ngraph TD; A-->B;\n```"} />,
    );

    await waitFor(() => {
      expect(container.querySelector("svg")).toBeTruthy();
    });
    expect(container.querySelector("pre .rendered-mermaid")).toBeFalsy();
    expect(container.querySelector("pre > .rendered-mermaid")).toBeFalsy();
  });
});
